using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace ExcavationApi.Contracts;

// ---------------------------------------------------------------- auth
public sealed record LoginRequest([Required] string Username, [Required] string Password);

public sealed record LoginResponse(string Token, string Username, string Role, int? AgencyId, string? AgencyName);

public sealed record AgencyDto(int Id, string Code, string NameAr, string NameEn);

// ---------------------------------------------------------------- excavations
/// <summary>Used by POST /analyze and POST /excavations.</summary>
public sealed record AnalyzeRequest
{
    /// <summary>One or more paths; each point is [lon, lat] in WGS84 (EPSG:4326).</summary>
    public List<List<double[]>>? Paths { get; init; }
    public double WidthMeters { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public string? WorkType { get; init; }
    public string? Notes { get; init; }
}

public sealed record ReviewRequest(string? Note);

public sealed record ExcavationDto(
    int Id,
    int AgencyId,
    string AgencyCode,
    string AgencyName,
    string WorkType,
    double WidthMeters,
    DateOnly StartDate,
    DateOnly EndDate,
    string Status,
    double? LengthMeters,
    double? AreaSquareMeters,
    string? Notes,
    string? ReviewNote,
    string? CreatedBy,
    DateTime CreatedAt,
    string? ReviewedBy,
    DateTime? ReviewedAt,
    JsonElement RouteGeoJson,
    JsonElement AreaGeoJson);

public sealed record ExcavationDetailDto(ExcavationDto Excavation, List<ConflictDto> Conflicts);

public sealed record CreateExcavationResponse(ExcavationDto Excavation, AnalysisResult Analysis);

// ---------------------------------------------------------------- analysis
public sealed record AnalysisResult
{
    public bool IsValid => Errors.Count == 0;
    public List<string> Errors { get; init; } = [];
    public double? LengthMeters { get; init; }
    public double? AreaSquareMeters { get; init; }
    public JsonElement? AreaGeoJson { get; init; }
    public List<ConflictDto> Conflicts { get; init; } = [];
    public List<SensitiveSiteHit> SensitiveSites { get; init; } = [];
    public List<PavedRoadHit> PavedRoads { get; init; } = [];
    public List<string> Warnings { get; init; } = [];
}

public sealed record ConflictDto(
    int ExcavationId,
    string AgencyName,
    string WorkType,
    string Status,
    DateOnly StartDate,
    DateOnly EndDate,
    int OverlapDays,
    double OverlapAreaSquareMeters,
    JsonElement? OverlapGeoJson,
    DigOnceDto? DigOnce);

public sealed record DigOnceDto(DateOnly SuggestedStartDate, DateOnly SuggestedEndDate, string Message);

public sealed record SensitiveSiteHit(int Id, string Name, string SiteType, double DistanceMeters);

public sealed record PavedRoadHit(int Id, string Name, DateOnly PavedDate, int MonthsSincePaving);

// ---------------------------------------------------------------- integration
public sealed record SyncResult(int Imported, int Updated);
