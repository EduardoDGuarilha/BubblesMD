using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace BubblesMd.Server.Suggest;

public interface ISuggestionProvider
{
    string Name { get; }
    Task<ModelOutcome> SuggestAsync(SuggestRequest request, string model, CancellationToken ct);
}

/// <summary>OpenRouter chat completions with a JSON-schema outcome. No retries and no model fallback.</summary>
public sealed class OpenRouterProvider(HttpClient http, IOptions<BubblesOptions> options, KeyResolver keys) : ISuggestionProvider
{
    public string Name => "openrouter";

    private static readonly JsonNode ResponseFormat = JsonNode.Parse("""
        {
          "type": "json_schema",
          "json_schema": {
            "name": "bubbles_suggestion",
            "strict": true,
            "schema": {
              "type": "object",
              "properties": {
                "outcome": { "type": "string", "enum": ["replace", "unchanged", "cannot_apply"] },
                "replacement": { "type": "string" },
                "reason": { "type": "string" }
              },
              "required": ["outcome", "replacement", "reason"],
              "additionalProperties": false
            }
          }
        }
        """)!;

    public async Task<ModelOutcome> SuggestAsync(SuggestRequest request, string model, CancellationToken ct)
    {
        var key = keys.Resolve() ?? throw new ProviderException("key_missing",
            $"The OpenRouter key is not configured on the server ({KeyResolver.EnvName}).", 503, "no");
        var (system, user) = PromptBuilder.Build(request);
        var body = new JsonObject
        {
            ["model"] = model,
            ["messages"] = new JsonArray
            {
                new JsonObject { ["role"] = "system", ["content"] = system },
                new JsonObject { ["role"] = "user", ["content"] = user },
            },
            ["max_tokens"] = options.Value.MaxOutputTokens,
            ["response_format"] = ResponseFormat.DeepClone(),
        };

        using var message = new HttpRequestMessage(HttpMethod.Post, "chat/completions")
        {
            Content = new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"),
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        message.Headers.Add("X-Title", "Bubbles.MD");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(options.Value.TimeoutSeconds));
        int status;
        string text;
        try
        {
            using var response = await http.SendAsync(message, timeout.Token);
            status = (int)response.StatusCode;
            text = await response.Content.ReadAsStringAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new ProviderException("timeout", "The model did not answer in time. Your writing is unchanged; use Retry.", 504, "unknown");
        }
        catch (HttpRequestException)
        {
            throw new ProviderException("provider_unreachable", "Could not reach OpenRouter. Your writing is unchanged; use Retry.", 502, "unknown");
        }
        if (status is < 200 or >= 300) throw MapHttpError(status, text);
        return OpenRouterParser.Parse(text, model);
    }

    public static ProviderException MapHttpError(int status, string body)
    {
        var detail = OpenRouterParser.ErrorMessage(body);
        return status switch
        {
            401 or 403 => new ProviderException("provider_auth", "OpenRouter rejected the server's key.", 503, "no"),
            402 => new ProviderException("budget", "OpenRouter reports insufficient credits or the key's spending limit was reached.", 402, "no"),
            408 => new ProviderException("timeout", "OpenRouter timed out. Your writing is unchanged; use Retry.", 504, "unknown"),
            429 => new ProviderException("rate_limited", "OpenRouter is rate limiting requests. Wait a moment, then Retry.", 429, "no"),
            400 or 404 or 422 => new ProviderException("provider_rejected", $"OpenRouter rejected the request: {detail}", 502, "no"),
            _ => new ProviderException("provider_error", $"OpenRouter error ({status}): {detail}", 502, "unknown"),
        };
    }
}

public static partial class OpenRouterParser
{
    private static readonly string[] Outcomes = ["replace", "unchanged", "cannot_apply"];

    [GeneratedRegex(@"<\s*(script|iframe|object|embed|style)\b|\]\(\s*(javascript|vbscript|data):", RegexOptions.IgnoreCase)]
    private static partial Regex UnsafeMarkdown();

    public static string ErrorMessage(string body)
    {
        try
        {
            var message = JsonNode.Parse(body)?["error"]?["message"]?.ToString();
            if (!string.IsNullOrWhiteSpace(message)) return message.Length > 300 ? message[..300] : message;
        }
        catch (JsonException) { }
        return "no details";
    }

    /// <summary>Validate the completion: finish status, JSON shape, outcome and Markdown safety. A missing cost stays null.</summary>
    public static ModelOutcome Parse(string body, string requestedModel)
    {
        JsonNode? root;
        try { root = JsonNode.Parse(body); }
        catch (JsonException) { throw Malformed("The provider response was not JSON."); }
        if (root is null) throw Malformed("The provider response was empty.");

        var usage = ParseUsage(root["usage"]);
        if (root["error"] is JsonNode error)
            throw new ProviderException("provider_error", $"OpenRouter error: {error["message"]?.ToString() ?? "unknown"}", 502, "unknown");

        var choice = root["choices"]?[0];
        var finish = choice?["finish_reason"]?.ToString();
        if (finish is "length")
            throw new ProviderException("truncated",
                "The model's answer was cut off before it finished. Nothing was applied; try a shorter selection or Retry.", 502, "unknown");
        if (finish is "error" or "content_filter")
            throw new ProviderException("provider_error", $"The model stopped with status '{finish}'.", 502, "unknown");

        var content = choice?["message"]?["content"]?.ToString();
        if (string.IsNullOrWhiteSpace(content)) throw Malformed("The model returned no content.");

        JsonNode? result;
        try { result = JsonNode.Parse(ExtractJson(content)); }
        catch (JsonException) { throw Malformed("The model's answer was not valid JSON."); }

        var outcome = result?["outcome"]?.ToString();
        var replacement = result?["replacement"] is JsonValue r && r.TryGetValue<string>(out var rs) ? rs : null;
        var reason = result?["reason"]?.ToString() ?? "";
        if (outcome is null || !Outcomes.Contains(outcome)) throw Malformed("The model returned an unknown outcome.");
        if (outcome == "replace" && replacement is null) throw Malformed("The model did not return a replacement.");
        if (outcome == "replace" && UnsafeMarkdown().IsMatch(replacement!))
            throw new ProviderException("unsafe_output", "The suggestion contained unsafe HTML or links and was discarded.", 502, "unknown");
        if (reason.Length > 500) reason = reason[..500];

        var model = root["model"]?.ToString();
        return new ModelOutcome(outcome, outcome == "replace" ? replacement! : "", reason,
            string.IsNullOrWhiteSpace(model) ? requestedModel : model, usage);
    }

    private static ProviderException Malformed(string message) =>
        new("malformed_output", message + " Nothing was applied; use Retry.", 502, "unknown");

    private static string ExtractJson(string content)
    {
        var start = content.IndexOf('{');
        var end = content.LastIndexOf('}');
        return start >= 0 && end > start ? content[start..(end + 1)] : content;
    }

    private static UsageDto ParseUsage(JsonNode? usage)
    {
        static int? Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) ? i : null;
        static decimal? Dec(JsonNode? n) => n is JsonValue v && v.TryGetValue<decimal>(out var d) ? d : null;
        if (usage is null) return new UsageDto(null, null, null, null);
        return new UsageDto(
            Int(usage["prompt_tokens"]),
            Int(usage["completion_tokens"]),
            Int(usage["completion_tokens_details"]?["reasoning_tokens"]),
            Dec(usage["cost"]));
    }
}
