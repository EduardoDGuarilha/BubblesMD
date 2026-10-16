using System.Text.RegularExpressions;

namespace BubblesMd.Server.Suggest;

/// <summary>
/// Zero-cost deterministic fixture provider (Bubbles:Provider = "fake") for mechanical and failure checks through
/// the real HTTP path. Reflection keywords select behaviour: #slow, #fail, #malformed, #unchanged, #cannot, #delete.
/// Otherwise it alters the first word, deletes the third word and appends a sentence.
/// </summary>
public sealed partial class FakeProvider : ISuggestionProvider
{
    public string Name => "fake";

    [GeneratedRegex(@"\p{L}[\p{L}\p{N}']*")]
    private static partial Regex Word();

    public async Task<ModelOutcome> SuggestAsync(SuggestRequest request, string model, CancellationToken ct)
    {
        var notes = string.Join(' ', (request.Reflections ?? []).Select(r => r.Text));
        var usage = new UsageDto(0, 0, 0, 0m);
        if (notes.Contains("#slow")) await Task.Delay(TimeSpan.FromSeconds(4), ct);
        if (notes.Contains("#fail")) throw new ProviderException("provider_error", "Fixture provider failure (#fail).", 502, "no");
        if (notes.Contains("#malformed"))
            throw new ProviderException("malformed_output", "Fixture malformed output (#malformed). Nothing was applied; use Retry.", 502, "no");
        if (notes.Contains("#unchanged")) return new ModelOutcome("unchanged", "", "Fixture: already fine.", "fake/fixture", usage);
        if (notes.Contains("#cannot")) return new ModelOutcome("cannot_apply", "", "Fixture: cannot apply.", "fake/fixture", usage);
        if (notes.Contains("#delete")) return new ModelOutcome("replace", "", "Fixture: delete the selection.", "fake/fixture", usage);

        var text = request.Selection ?? "";
        var words = Word().Matches(text).ToList();
        var result = text;
        if (words.Count >= 3)
        {
            var third = words[2];
            var end = third.Index + third.Length;
            if (end < result.Length && result[end] == ' ') end++;
            result = result.Remove(third.Index, end - third.Index);
        }
        if (words.Count >= 1)
        {
            var first = words[0];
            result = result.Remove(first.Index, first.Length).Insert(first.Index, first.Value.ToUpperInvariant());
        }
        var trailing = result.Length - result.TrimEnd().Length;
        result = result.TrimEnd() + " Fixture addition." + new string(' ', trailing);
        return new ModelOutcome("replace", result, "Fixture suggestion.", "fake/fixture", usage);
    }
}
