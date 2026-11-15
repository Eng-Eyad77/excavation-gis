using ExcavationApi.Contracts;
using ExcavationApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ExcavationApi.Controllers;

[ApiController]
[Route("api/integration")]
[Authorize(Roles = Roles.Reviewer)]
public sealed class IntegrationController(ArcGisSyncService sync) : ControllerBase
{
    /// <summary>
    /// Pull the sensitive-sites hosted feature layer (ArcGIS:SensitiveSitesLayerUrl) through the
    /// ArcGIS REST API (/query?f=geojson) and upsert it into Oracle.
    /// </summary>
    [HttpPost("arcgis/sync-sensitive-sites")]
    [ProducesResponseType<SyncResult>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status502BadGateway)]
    public async Task<IActionResult> SyncSensitiveSites(CancellationToken ct)
    {
        try
        {
            return Ok(await sync.SyncSensitiveSitesAsync(ct));
        }
        catch (ArcGisSyncException ex)
        {
            return Problem(title: ex.Message, statusCode: ex.StatusCode);
        }
    }
}
