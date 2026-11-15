using System.Globalization;

namespace ExcavationApi.Domain;

public sealed record DigOnceSuggestion(DateOnly SuggestedStartDate, DateOnly SuggestedEndDate, string Message);

/// <summary>
/// "Dig once": when two agencies need the same street at the same time, suggest that
/// they share one window, so the street is excavated and repaved once instead of twice.
/// </summary>
public static class DigOncePlanner
{
    /// <summary>
    /// Shared window: start on the later of the two start dates (aligned to the other agency
    /// when it starts later) and keep my own duration. Returns null when there is no overlap.
    /// </summary>
    public static DigOnceSuggestion? Suggest(DateRange mine, DateRange other, string myAgency, string otherAgency)
    {
        if (!mine.Overlaps(other)) return null;

        var start = mine.Start > other.Start ? mine.Start : other.Start;
        var end = start.AddDays(mine.DurationDays - 1);   // same number of working days as requested

        var s = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var e = end.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var message =
            $"مقترح «احفر مرة واحدة»: تنسّق {myAgency} مع {otherAgency} لتنفيذ الأعمال في نفس النافذة " +
            $"من {s} إلى {e}، فيُحفر الشارع ويُعاد سفلتته مرة واحدة بدلاً من مرتين.";

        return new DigOnceSuggestion(start, end, message);
    }
}
