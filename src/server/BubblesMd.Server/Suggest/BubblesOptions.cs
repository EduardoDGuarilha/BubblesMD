namespace BubblesMd.Server.Suggest;

public sealed class ModeOptions
{
    public string Label { get; set; } = "";
    public string Model { get; set; } = "";
    public decimal? InputPerMillion { get; set; }
    public decimal? OutputPerMillion { get; set; }
}

public sealed class BubblesOptions
{
    /// <summary>"openrouter" for real calls, "fake" for zero-cost deterministic fixtures.</summary>
    public string Provider { get; set; } = "openrouter";
    public int MaxOutputTokens { get; set; } = 8000;
    public int TimeoutSeconds { get; set; } = 90;
    public Dictionary<string, ModeOptions> Modes { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Resolves the OpenRouter key at request time. On Windows the current user-scope value is read from the
/// registry, so a key set after the server started is picked up without a restart; otherwise standard
/// configuration (environment variables) is used. The key is never logged or returned.
/// </summary>
public sealed class KeyResolver(IConfiguration config)
{
    public const string EnvName = "OPENROUTER_API_KEY";

    public string? Resolve()
    {
        if (OperatingSystem.IsWindows())
        {
            var user = Environment.GetEnvironmentVariable(EnvName, EnvironmentVariableTarget.User);
            if (!string.IsNullOrWhiteSpace(user)) return user.Trim();
        }
        var value = config[EnvName];
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
