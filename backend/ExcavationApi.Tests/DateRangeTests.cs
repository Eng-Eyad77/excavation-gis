using ExcavationApi.Domain;

namespace ExcavationApi.Tests;

public class DateRangeTests
{
    private static DateRange R(string start, string end) => new(DateOnly.Parse(start), DateOnly.Parse(end));

    [Fact]
    public void Overlapping_ranges_count_shared_days_inclusive()
    {
        var mine = R("2026-12-01", "2026-12-15");
        var nwc = R("2026-12-10", "2026-12-20");

        Assert.True(mine.Overlaps(nwc));
        Assert.Equal(6, mine.OverlapDays(nwc));    // 10,11,12,13,14,15
        Assert.Equal(6, nwc.OverlapDays(mine));    // symmetric
    }

    [Fact]
    public void Touching_on_the_same_day_is_an_overlap_of_one_day()
    {
        var a = R("2026-12-01", "2026-12-10");
        var b = R("2026-12-10", "2026-12-20");

        Assert.True(a.Overlaps(b));
        Assert.Equal(1, a.OverlapDays(b));
    }

    [Fact]
    public void Separate_ranges_do_not_overlap()
    {
        var a = R("2026-12-01", "2026-12-09");
        var b = R("2026-12-10", "2026-12-20");

        Assert.False(a.Overlaps(b));
        Assert.Equal(0, a.OverlapDays(b));
    }

    [Fact]
    public void Contained_range_overlaps_for_its_whole_duration()
    {
        var outer = R("2026-12-01", "2026-12-31");
        var inner = R("2026-12-05", "2026-12-07");

        Assert.True(outer.Overlaps(inner));
        Assert.Equal(3, outer.OverlapDays(inner));
        Assert.Equal(3, inner.DurationDays);
    }

    [Fact]
    public void End_before_start_is_rejected()
    {
        Assert.Throws<ArgumentException>(() => R("2026-12-10", "2026-12-01"));
    }
}
