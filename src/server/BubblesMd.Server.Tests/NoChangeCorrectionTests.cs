using BubblesMd.Server.Suggest;

namespace BubblesMd.Server.Tests;

public class NoChangeCorrectionTests
{
    /// <summary>Returns queued outcomes in order and records the prompts it was given.</summary>
    private sealed class ScriptedProvider(params Func<ChatPrompt, ModelOutcome>[] script) : ISuggestionProvider
    {
        public List<ChatPrompt> Prompts { get; } = [];
        public string Name => "scripted";

        public Task<ModelOutcome> SuggestAsync(SuggestRequest request, string model, ChatPrompt prompt, CancellationToken ct)
        {
            Prompts.Add(prompt);
            return Task.FromResult(script[Prompts.Count - 1](prompt));
        }
    }

    private static ModelOutcome Replace(string text, decimal? cost = 0.001m) =>
        new("replace", text, "", "m", new UsageDto(100, 20, 0, cost), $"{{\"replacement\":\"{text}\"}}");

    private static SuggestRequest Refine(string proposal) =>
        new("r1", "rev", 1, "refine", "smart", "We will collect their feedback after each session.", "", "",
            [new ReflectionDto("t1", "Warmer."), new ReflectionDto("t2", "too verbose", IsNew: true)],
            new PriorCandidateDto("We will collect their feedback after each session.", proposal, []));

    [Fact]
    public void IsUnchanged_ignores_spacing_but_not_paragraphs_formatting_or_an_empty_replacement()
    {
        Assert.True(TextCompare.IsUnchanged("Keep  this text.\n", "Keep this text."));
        Assert.False(TextCompare.IsUnchanged("One. Two.", "One.\n\nTwo."));
        Assert.False(TextCompare.IsUnchanged("Keep this text.", "Keep **this** text."));
        Assert.False(TextCompare.IsUnchanged("Delete me.", ""));
    }

    [Fact]
    public async Task Unchanged_refinement_gets_exactly_one_correction_and_both_calls_are_reported()
    {
        const string proposal = "We will warmly collect everyone's feedback after each and every session.";
        var provider = new ScriptedProvider(_ => Replace(proposal), _ => Replace("We'll gather feedback after each session."));
        var run = await SuggestOrchestrator.RunAsync(provider, Refine(proposal), "m", CancellationToken.None);

        Assert.Equal("We'll gather feedback after each session.", run.Result.Replacement);
        Assert.Equal(2, run.Attempts.Count);
        Assert.Equal(0.002m, SuggestOrchestrator.Sum(run.Attempts).Cost);
        var correction = provider.Prompts[1];
        Assert.True(correction.IsCorrection);
        Assert.Equal("assistant", correction.Turns[1].Role);
        Assert.Contains("made no change to CURRENT_PROPOSAL", correction.Turns[2].Content);
        Assert.Contains("\"too verbose\"", correction.Turns[2].Content);
        Assert.Contains("(new) too verbose", provider.Prompts[0].Turns[0].Content);
    }

    [Fact]
    public async Task Still_unchanged_after_the_correction_is_returned_as_such_without_a_third_call()
    {
        var provider = new ScriptedProvider(
            _ => new ModelOutcome("unchanged", "", "Already fine.", "m", new UsageDto(1, 1, 0, null)),
            _ => Replace("We will collect their feedback after each session."));
        var request = Refine("p") with { Action = "initial", Prior = null };
        var run = await SuggestOrchestrator.RunAsync(provider, request, "m", CancellationToken.None);

        Assert.True(SuggestOrchestrator.MadeNoChange(request, run.Result));
        Assert.Equal(2, provider.Prompts.Count);
        Assert.Null(SuggestOrchestrator.Sum(run.Attempts).Cost); // one part unknown → total unknown, never zero
    }

    [Fact]
    public void The_removed_revise_action_is_rejected()
    {
        Assert.Contains(SuggestLimits.Validate(Refine("p") with { Action = "revise" }), e => e.StartsWith("action must be"));
    }

    [Fact]
    public async Task A_failed_correction_still_reports_the_first_call()
    {
        const string proposal = "Same text.";
        var provider = new ScriptedProvider(_ => Replace(proposal), _ => throw new ProviderException("timeout", "late", 504, "unknown"));
        var e = await Assert.ThrowsAsync<ProviderException>(() => SuggestOrchestrator.RunAsync(provider, Refine(proposal), "m", CancellationToken.None));
        Assert.Equal("timeout", e.Code);
        Assert.Single(e.Attempts);
        Assert.Equal(0.001m, e.Attempts[0].Usage.Cost);
    }
}
