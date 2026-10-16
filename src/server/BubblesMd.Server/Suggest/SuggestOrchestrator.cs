using System.Diagnostics;
using System.Text.RegularExpressions;

namespace BubblesMd.Server.Suggest;

/// <summary>
/// Textual no-change test (mirrors the client): runs of spaces/tabs within a line and trailing whitespace are
/// ignored; newlines, Markdown syntax and an intentionally empty replacement still count as changes. It proves only
/// that the text did or did not change, never that it improved.
/// </summary>
public static partial class TextCompare
{
    [GeneratedRegex("[ \t]+")]
    private static partial Regex HorizontalSpace();

    public static string Normalize(string text) =>
        string.Join('\n', text.Replace("\r\n", "\n").Split('\n').Select(line => HorizontalSpace().Replace(line, " ").TrimEnd())).TrimEnd();

    public static bool IsUnchanged(string baseline, string result)
    {
        if (result.Trim().Length == 0 && baseline.Trim().Length > 0) return false;
        return Normalize(baseline) == Normalize(result);
    }
}

public sealed record OrchestratedResult(ModelOutcome Result, List<AttemptDto> Attempts, long LatencyMs);

/// <summary>
/// Runs one suggestion request. If the model makes no change where the writer asked for one, it makes exactly one
/// corrective call with the same model and context; both calls are reported so their cost is counted.
/// </summary>
public static class SuggestOrchestrator
{
    /// <summary>What a result must differ from: the effective proposal for refine, otherwise the selection.</summary>
    public static string Baseline(SuggestRequest r) =>
        r.Action == "refine" && r.Prior?.Candidate is { } candidate ? candidate : r.Selection ?? "";

    public static bool MadeNoChange(SuggestRequest r, ModelOutcome o) =>
        o.Outcome == "unchanged" || (o.Outcome == "replace" && TextCompare.IsUnchanged(Baseline(r), o.Replacement));

    public static async Task<OrchestratedResult> RunAsync(ISuggestionProvider provider, SuggestRequest request, string model, CancellationToken ct)
    {
        var total = Stopwatch.StartNew();
        var prompt = PromptBuilder.Build(request);
        var attempts = new List<AttemptDto>();

        var first = await Timed(provider, request, model, prompt, ct);
        attempts.Add(first.Attempt);
        if (!MadeNoChange(request, first.Result))
            return new OrchestratedResult(first.Result, attempts, total.ElapsedMilliseconds);

        var corrected = prompt.WithCorrection(first.Result.RawContent, PromptBuilder.Correction(request));
        try
        {
            var second = await Timed(provider, request, model, corrected, ct);
            attempts.Add(second.Attempt);
            return new OrchestratedResult(second.Result, attempts, total.ElapsedMilliseconds);
        }
        catch (ProviderException e)
        {
            throw new ProviderException(e.Code, e.Message, e.Status, e.Charged) { Attempts = attempts };
        }
    }

    /// <summary>Sum usage across attempts; any unknown part makes the total unknown (never zero).</summary>
    public static UsageDto Sum(IEnumerable<AttemptDto> attempts)
    {
        var list = attempts.Select(a => a.Usage).ToList();
        int? SumInt(Func<UsageDto, int?> f) => list.Any(u => f(u) is null) ? null : list.Sum(u => f(u)!.Value);
        decimal? cost = list.Any(u => u.Cost is null) ? null : list.Sum(u => u.Cost!.Value);
        return new UsageDto(SumInt(u => u.PromptTokens), SumInt(u => u.CompletionTokens), SumInt(u => u.ReasoningTokens), cost);
    }

    private static async Task<(ModelOutcome Result, AttemptDto Attempt)> Timed(
        ISuggestionProvider provider, SuggestRequest request, string model, ChatPrompt prompt, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        var result = await provider.SuggestAsync(request, model, prompt, ct);
        return (result, new AttemptDto(result.Model, result.Outcome, result.Usage, watch.ElapsedMilliseconds));
    }
}
