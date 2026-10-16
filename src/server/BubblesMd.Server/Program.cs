using System.Diagnostics;
using BubblesMd.Server.Suggest;
using Microsoft.Extensions.Options;

// A published build carries wwwroot next to the DLL: use that folder as content root so the app starts correctly
// from any working directory. `dotnet run` keeps the default (project folder).
var publishedRoot = Directory.Exists(Path.Combine(AppContext.BaseDirectory, "wwwroot")) ? AppContext.BaseDirectory : null;
var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = publishedRoot });

builder.Services.Configure<BubblesOptions>(builder.Configuration.GetSection("Bubbles"));
builder.Services.AddSingleton<KeyResolver>();
builder.Services.AddSingleton<FakeProvider>();
builder.Services.AddHttpClient<OpenRouterProvider>(client =>
{
    client.BaseAddress = new Uri("https://openrouter.ai/api/v1/");
    // The provider applies its own configurable timeout; this is only a backstop.
    client.Timeout = TimeSpan.FromMinutes(3);
});
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = SuggestLimits.MaxBodyBytes);

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/config", (IOptions<BubblesOptions> options, KeyResolver keys) =>
{
    var o = options.Value;
    return Results.Ok(new
    {
        provider = o.Provider,
        keyConfigured = o.Provider == "fake" || keys.Resolve() is not null,
        modes = SuggestLimits.Modes.Where(o.Modes.ContainsKey).Select(m => new
        {
            mode = m,
            label = o.Modes[m].Label,
            model = o.Provider == "fake" ? "fake/fixture" : o.Modes[m].Model,
            inputPerMillion = o.Modes[m].InputPerMillion,
            outputPerMillion = o.Modes[m].OutputPerMillion,
        }),
        limits = new
        {
            selectionChars = SuggestLimits.SelectionChars,
            contextChars = SuggestLimits.ContextChars,
            reflectionChars = SuggestLimits.ReflectionChars,
            importBytes = SuggestLimits.ImportBytes,
        },
    });
});

app.MapPost("/api/suggest", async (SuggestRequest request, IOptions<BubblesOptions> options, IServiceProvider services,
    ILogger<Program> log, CancellationToken ct) =>
{
    var errors = SuggestLimits.Validate(request);
    if (errors.Count > 0)
        return Results.Json(new ErrorBody(new ErrorDetail("invalid_request", string.Join(" ", errors), "no")), statusCode: 400);

    var o = options.Value;
    if (!o.Modes.TryGetValue(request.Mode!, out var mode) || string.IsNullOrWhiteSpace(mode.Model))
        return Results.Json(new ErrorBody(new ErrorDetail("invalid_mode", "That mode is not configured.", "no")), statusCode: 400);

    ISuggestionProvider provider = o.Provider == "fake"
        ? services.GetRequiredService<FakeProvider>()
        : services.GetRequiredService<OpenRouterProvider>();
    var watch = Stopwatch.StartNew();
    try
    {
        var result = await provider.SuggestAsync(request, mode.Model, ct);
        watch.Stop();
        log.LogInformation("Suggest {RequestId} {Action} {Mode} -> {Model} {Outcome} in {Ms} ms; tokens {In}/{Out}/{Reasoning}; cost {Cost}",
            request.RequestId, request.Action, request.Mode, result.Model, result.Outcome, watch.ElapsedMilliseconds,
            result.Usage.PromptTokens, result.Usage.CompletionTokens, result.Usage.ReasoningTokens, result.Usage.Cost?.ToString() ?? "unknown");
        return Results.Ok(new SuggestResponse(request.RequestId!, request.ReviewId!, request.Revision, result.Outcome,
            result.Outcome == "replace" ? result.Replacement : null,
            string.IsNullOrWhiteSpace(result.Reason) ? null : result.Reason,
            request.Mode!, result.Model, provider.Name, result.Usage, watch.ElapsedMilliseconds));
    }
    catch (ProviderException e)
    {
        log.LogWarning("Suggest {RequestId} failed after {Ms} ms: {Code} {Message}", request.RequestId, watch.ElapsedMilliseconds, e.Code, e.Message);
        return Results.Json(new ErrorBody(new ErrorDetail(e.Code, e.Message, e.Charged)), statusCode: e.Status);
    }
    catch (OperationCanceledException) when (ct.IsCancellationRequested)
    {
        log.LogInformation("Suggest {RequestId} cancelled by the client after {Ms} ms", request.RequestId, watch.ElapsedMilliseconds);
        return Results.Json(new ErrorBody(new ErrorDetail("cancelled", "Request cancelled.", "unknown")), statusCode: 499);
    }
});

app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
