using System.Text.Json.Nodes;
using ExcavationApi.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ExcavationApi.Controllers;

/// <summary>Reference layers for the map, as GeoJSON FeatureCollections (WGS84).</summary>
[ApiController]
[Route("api/layers")]
[Authorize]
public sealed class LayersController(LayerRepository layers) : ControllerBase
{
    [HttpGet("sensitive-sites")]
    public Task<JsonObject> SensitiveSites(CancellationToken ct) => layers.SensitiveSitesAsync(ct);

    /// <summary>Paved roads with pavedDate and isRecent (paved within Analysis:PavedProtectionMonths).</summary>
    [HttpGet("paved-roads")]
    public Task<JsonObject> PavedRoads(CancellationToken ct) => layers.PavedRoadsAsync(ct);

    [HttpGet("city-boundary")]
    public Task<JsonObject> CityBoundary(CancellationToken ct) => layers.CityBoundaryAsync(ct);
}
