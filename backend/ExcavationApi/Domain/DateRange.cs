namespace ExcavationApi.Domain;

/// <summary>
/// An inclusive date range (both Start and End are working days of the excavation).
/// The temporal half of "spatio-temporal" conflict detection.
/// </summary>
public readonly record struct DateRange
{
    public DateOnly Start { get; }
    public DateOnly End { get; }

    public DateRange(DateOnly start, DateOnly end)
    {
        if (end < start) throw new ArgumentException("End date must be on or after start date.", nameof(end));
        Start = start;
        End = end;
    }

    /// <summary>Number of days, counting both ends (1 Dec → 1 Dec = 1 day).</summary>
    public int DurationDays => End.DayNumber - Start.DayNumber + 1;

    /// <summary>Two ranges overlap when each one starts before (or on) the day the other ends.</summary>
    public bool Overlaps(DateRange other) => Start <= other.End && End >= other.Start;

    /// <summary>Inclusive count of shared days; 0 when the ranges do not overlap.</summary>
    public int OverlapDays(DateRange other)
    {
        if (!Overlaps(other)) return 0;
        var start = Start > other.Start ? Start : other.Start;
        var end = End < other.End ? End : other.End;
        return end.DayNumber - start.DayNumber + 1;
    }
}
