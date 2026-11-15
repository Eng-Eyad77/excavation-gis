using ExcavationApi.Contracts;
using ExcavationApi.Data;
using ExcavationApi.Domain;
using ExcavationApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ExcavationApi.Controllers;

[ApiController]
[Route("api/excavations")]
[Authorize]
public sealed class ExcavationsController(AnalysisService analysis, ExcavationRepository excavations) : ControllerBase
{
    private static readonly string[] Statuses = ["Pending", "Approved", "Rejected"];

    /// <summary>Run the full spatial analysis WITHOUT saving (instant feedback while drawing).</summary>
    [HttpPost("analyze")]
    [Authorize(Roles = $"{Roles.Applicant},{Roles.Reviewer}")]
    public async Task<AnalysisResult> Analyze(AnalyzeRequest request, CancellationToken ct)
    {
        var (result, _) = await analysis.AnalyzeAsync(request, User.AgencyName(), ct);
        return result;
    }

    /// <summary>Re-run the analysis on the server and save as Pending if valid. The agency comes from the token.</summary>
    [HttpPost]
    [Authorize(Roles = Roles.Applicant)]
    [ProducesResponseType<CreateExcavationResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create(AnalyzeRequest request, CancellationToken ct)
    {
        if (User.AgencyId() is not int agencyId)
            return Problem(title: "المستخدم غير مرتبط بجهة.", statusCode: StatusCodes.Status403Forbidden);

        var (result, wkt) = await analysis.AnalyzeAsync(request, User.AgencyName(), ct);
        if (!result.IsValid || wkt is null)
        {
            var problem = new ProblemDetails
            {
                Title = "لا يمكن تقديم الطلب: يوجد أخطاء في البيانات.",
                Status = StatusCodes.Status400BadRequest,
            };
            problem.Extensions["errors"] = result.Errors;
            problem.Extensions["analysis"] = result;
            return BadRequest(problem);
        }

        var id = await excavations.InsertAsync(new NewExcavation(
            agencyId, User.UserId(), request.WorkType!.Trim(), request.WidthMeters,
            request.StartDate, request.EndDate, string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
            wkt, result.LengthMeters ?? 0, result.AreaSquareMeters ?? 0), ct);

        var created = await excavations.GetAsync(id, ct);
        return CreatedAtAction(nameof(Get), new { id }, new CreateExcavationResponse(created!, result));
    }

    /// <summary>All requests (any role can see the map). Optional filters: status, agencyId.</summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] int? agencyId, CancellationToken ct)
    {
        if (status is not null && !Statuses.Contains(status))
            return Problem(title: "قيمة الحالة غير صحيحة. القيم المسموحة: Pending, Approved, Rejected.", statusCode: 400);
        return Ok(await excavations.ListAsync(status, agencyId, ct));
    }

    /// <summary>One request plus its CURRENT conflicts (re-computed with exclude_id = id).</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType<ExcavationDetailDto>(StatusCodes.Status200OK)]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var item = await excavations.GetAsync(id, ct);
        if (item is null) return Problem(title: "الطلب غير موجود.", statusCode: StatusCodes.Status404NotFound);

        // A rejected request will not be dug, so it has no conflicts (and other requests ignore it too).
        if (item.Status == "Rejected") return Ok(new ExcavationDetailDto(item, []));

        var wkt = await excavations.GetRouteWktAsync(id, ct);
        var conflicts = await analysis.ConflictsForExistingAsync(
            id, wkt!, item.WidthMeters, new DateRange(item.StartDate, item.EndDate), item.AgencyName, ct);
        return Ok(new ExcavationDetailDto(item, conflicts));
    }

    [HttpPost("{id:int}/approve")]
    [Authorize(Roles = Roles.Reviewer)]
    public Task<IActionResult> Approve(int id, ReviewRequest body, CancellationToken ct) => Review(id, "Approved", body.Note, ct);

    /// <summary>Reject a request. A note explaining why is required.</summary>
    [HttpPost("{id:int}/reject")]
    [Authorize(Roles = Roles.Reviewer)]
    public Task<IActionResult> Reject(int id, ReviewRequest body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Note))
            return Task.FromResult<IActionResult>(Problem(title: "سبب الرفض مطلوب.", statusCode: 400));
        return Review(id, "Rejected", body.Note, ct);
    }

    private async Task<IActionResult> Review(int id, string status, string? note, CancellationToken ct)
    {
        if (note is { Length: > 1000 }) return Problem(title: "الملاحظة يجب ألا تتجاوز 1000 حرف.", statusCode: 400);

        var item = await excavations.GetAsync(id, ct);
        if (item is null) return Problem(title: "الطلب غير موجود.", statusCode: StatusCodes.Status404NotFound);

        if (!await excavations.ReviewAsync(id, status, note?.Trim(), User.UserId(), ct))
            return Problem(title: $"لا يمكن مراجعة الطلب لأن حالته الحالية {item.Status}. المراجعة متاحة للطلبات المعلّقة فقط.",
                statusCode: StatusCodes.Status409Conflict);

        return Ok(await excavations.GetAsync(id, ct));
    }
}
