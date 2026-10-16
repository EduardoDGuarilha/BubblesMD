namespace BubblesMd.Server.Suggest;

/// <summary>IsNew marks reflections added or edited since the active suggestion was generated.</summary>
public sealed record ReflectionDto(string? Id, string? Text, bool IsNew = false);

public sealed record KeepOriginalDto(string? Original, string? Proposed);

public sealed record PriorCandidateDto(string? Source, string? Candidate, List<KeepOriginalDto>? KeepOriginal);

/// <summary>One bounded suggestion request for a single review. The client never chooses the model or endpoint.</summary>
public sealed record SuggestRequest(
    string? RequestId,
    string? ReviewId,
    int Revision,
    string? Action,
    string? Mode,
    string? Selection,
    string? ContextBefore,
    string? ContextAfter,
    List<ReflectionDto>? Reflections,
    PriorCandidateDto? Prior);

/// <summary>Usage as returned by the provider. A null cost means unknown, never zero.</summary>
public sealed record UsageDto(int? PromptTokens, int? CompletionTokens, int? ReasoningTokens, decimal? Cost);

public sealed record SuggestResponse(
    string RequestId,
    string ReviewId,
    int Revision,
    string Outcome,
    string? Replacement,
    string? Reason,
    string Mode,
    string Model,
    string Provider,
    UsageDto Usage,
    long LatencyMs,
    List<AttemptDto> Attempts);

/// <summary>One provider call. Usage is summed across attempts in the response; each attempt is also reported.</summary>
public sealed record AttemptDto(string Model, string Outcome, UsageDto Usage, long LatencyMs);

/// <summary>Charged is "no" when nothing reached a paid provider, otherwise "unknown".</summary>
public sealed record ErrorDetail(string Code, string Message, string Charged, List<AttemptDto>? Attempts = null);

public sealed record ErrorBody(ErrorDetail Error);

/// <summary>Validated model output: exactly one outcome for the captured selection.</summary>
public sealed record ModelOutcome(string Outcome, string Replacement, string Reason, string Model, UsageDto Usage, string RawContent = "");

public sealed class ProviderException(string code, string message, int status, string charged) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
    public string Charged { get; } = charged;

    /// <summary>Provider calls that completed before this failure; their usage still counts.</summary>
    public List<AttemptDto> Attempts { get; init; } = [];
}

public static class SuggestLimits
{
    public const int SelectionChars = 16_000;
    public const int ContextChars = 4_000;
    public const int ReflectionChars = 8_000;
    public const int MaxReflections = 50;
    public const int PriorChars = 32_000;
    public const int ImportBytes = 1_048_576;
    public const long MaxBodyBytes = 256 * 1024;

    public static readonly string[] Actions = ["initial", "refine", "refresh"];
    public static readonly string[] Modes = ["fast", "smart"];

    public static List<string> Validate(SuggestRequest r)
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(r.RequestId) || r.RequestId.Length > 100) errors.Add("requestId is required.");
        if (string.IsNullOrWhiteSpace(r.ReviewId) || r.ReviewId.Length > 100) errors.Add("reviewId is required.");
        if (r.Action is null || !Actions.Contains(r.Action)) errors.Add("action must be initial, refine or refresh.");
        if (r.Mode is null || !Modes.Contains(r.Mode)) errors.Add("mode must be fast or smart.");
        if (string.IsNullOrEmpty(r.Selection)) errors.Add("selection must not be empty.");
        else if (r.Selection.Length > SelectionChars)
            errors.Add($"The selection is {r.Selection.Length:N0} characters; the limit is {SelectionChars:N0}.");
        var context = (r.ContextBefore?.Length ?? 0) + (r.ContextAfter?.Length ?? 0);
        if (context > ContextChars) errors.Add($"Surrounding context is {context:N0} characters; the limit is {ContextChars:N0}.");
        var reflections = r.Reflections ?? [];
        if (reflections.Count == 0 || reflections.All(x => string.IsNullOrWhiteSpace(x.Text)))
            errors.Add("At least one reflection is required.");
        if (reflections.Count > MaxReflections) errors.Add($"At most {MaxReflections} reflections are allowed.");
        var reflectionChars = reflections.Sum(x => x.Text?.Length ?? 0);
        if (reflectionChars > ReflectionChars)
            errors.Add($"Reflections total {reflectionChars:N0} characters; the limit is {ReflectionChars:N0}.");
        if (r.Action is "refine" or "refresh" && r.Prior is null)
            errors.Add("A previous suggestion is required to refine or refresh.");
        if (r.Prior is { } p)
        {
            var priorChars = (p.Source?.Length ?? 0) + (p.Candidate?.Length ?? 0)
                + (p.KeepOriginal ?? []).Sum(k => (k.Original?.Length ?? 0) + (k.Proposed?.Length ?? 0));
            if (priorChars > PriorChars) errors.Add($"The previous suggestion is too large ({priorChars:N0} characters).");
        }
        return errors;
    }
}
