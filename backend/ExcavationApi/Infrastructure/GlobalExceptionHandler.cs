using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Oracle.ManagedDataAccess.Client;

namespace ExcavationApi.Infrastructure;

/// <summary>
/// Logs the real exception server-side and returns a generic RFC 7807 ProblemDetails.
/// Stack traces and SQL never reach the client.
/// </summary>
public sealed class GlobalExceptionHandler(IProblemDetailsService problemDetails, ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        if (exception is OperationCanceledException && context.RequestAborted.IsCancellationRequested)
            return true; // client went away; nothing to send

        logger.LogError(exception, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);

        var (status, title) = exception switch
        {
            OracleException => (StatusCodes.Status503ServiceUnavailable, "قاعدة البيانات غير متاحة حالياً. حاول مرة أخرى لاحقاً."),
            InvalidOperationException e when e.Message.Contains("not configured") || e.Message.Contains("Jwt:Key") =>
                (StatusCodes.Status500InternalServerError, "إعدادات الخادم غير مكتملة."),
            _ => (StatusCodes.Status500InternalServerError, "حدث خطأ غير متوقع في الخادم."),
        };

        context.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = new ProblemDetails { Status = status, Title = title },
        });
    }
}
