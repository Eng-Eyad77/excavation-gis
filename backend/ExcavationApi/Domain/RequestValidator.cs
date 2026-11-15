namespace ExcavationApi.Domain;

/// <summary>Input the validator needs (kept independent of the HTTP contracts).</summary>
public sealed record ExcavationInput(
    IReadOnlyList<IReadOnlyList<double[]>>? Paths,
    double WidthMeters,
    DateOnly StartDate,
    DateOnly EndDate,
    string? WorkType,
    string? Notes);

/// <summary>
/// Pure C# checks that run before any Oracle query: shape of the input, coordinate sanity
/// (including UTM metres typed as degrees), width and date rules. Messages are in Arabic.
/// </summary>
public static class RequestValidator
{
    public const double MinWidth = 0.3;
    public const double MaxWidth = 10;
    public const int MaxDurationDays = 180;

    public static List<string> Validate(ExcavationInput input, DateOnly today, bool isNewRequest)
    {
        var errors = new List<string>();
        ValidateGeometry(input.Paths, errors);

        if (double.IsNaN(input.WidthMeters) || input.WidthMeters < MinWidth || input.WidthMeters > MaxWidth)
            errors.Add($"عرض الحفرية يجب أن يكون بين {MinWidth} و {MaxWidth} متر.");

        if (input.EndDate < input.StartDate)
            errors.Add("تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو يساويه.");
        else if (input.EndDate.DayNumber - input.StartDate.DayNumber + 1 > MaxDurationDays)
            errors.Add($"مدة الحفرية لا يجوز أن تتجاوز {MaxDurationDays} يوماً.");

        if (isNewRequest && input.StartDate < today)
            errors.Add("تاريخ البداية لا يمكن أن يكون في الماضي.");

        if (string.IsNullOrWhiteSpace(input.WorkType))
            errors.Add("نوع العمل مطلوب.");
        else if (input.WorkType.Length > 100)
            errors.Add("نوع العمل يجب ألا يتجاوز 100 حرف.");

        if (input.Notes is { Length: > 1000 })
            errors.Add("الملاحظات يجب ألا تتجاوز 1000 حرف.");

        return errors;
    }

    private static void ValidateGeometry(IReadOnlyList<IReadOnlyList<double[]>>? paths, List<string> errors)
    {
        if (paths is null || paths.Count == 0)
        {
            errors.Add("يجب رسم مسار واحد على الأقل.");
            return;
        }

        var looksLikeUtm = false;
        var outOfRange = false;
        var looksSwapped = false;
        for (var i = 0; i < paths.Count; i++)
        {
            var path = paths[i];
            if (path is null || path.Count < 2)
            {
                errors.Add($"المسار رقم {i + 1} يجب أن يحتوي على نقطتين على الأقل.");
                continue;
            }
            foreach (var p in path)
            {
                if (p is null || p.Length < 2 || double.IsNaN(p[0]) || double.IsNaN(p[1]) || double.IsInfinity(p[0]) || double.IsInfinity(p[1]))
                {
                    errors.Add($"المسار رقم {i + 1} يحتوي على نقطة غير صالحة.");
                    break;
                }
                double lon = p[0], lat = p[1];
                // Degrees never exceed 180. Values like 500000 / 2380000 are UTM metres.
                if (Math.Abs(lon) > 180 || Math.Abs(lat) > 180) looksLikeUtm = true;
                else if (Math.Abs(lat) > 90) outOfRange = true;
                // Jeddah is lon ≈ 39, lat ≈ 21.5: (21.5, 39) means lat/lon were entered in the wrong order.
                else if (lon is > 15 and < 30 && lat is > 33 and < 45) looksSwapped = true;
            }
        }

        if (looksLikeUtm)
            errors.Add("الإحداثيات تبدو بالأمتار (UTM) وليست بالدرجات. استخدم تبويب «إدخال إحداثيات UTM» لعرضها على الخريطة.");
        if (outOfRange)
            errors.Add("خط العرض يجب أن يكون بين -90 و 90، وخط الطول بين -180 و 180.");
        if (looksSwapped)
            errors.Add("يبدو أن خط الطول وخط العرض معكوسان. الترتيب الصحيح: خط الطول ثم خط العرض (lon, lat).");
    }
}
