using ExcavationApi.Domain;

namespace ExcavationApi.Tests;

public class DigOncePlannerTests
{
    private static DateRange R(string start, string end) => new(DateOnly.Parse(start), DateOnly.Parse(end));

    [Fact]
    public void Demo_scenario_is_aligned_to_the_other_agency_start_and_keeps_my_duration()
    {
        var mine = R("2026-12-01", "2026-12-15");  // STC, 15 days
        var nwc = R("2026-12-10", "2026-12-20");

        var s = DigOncePlanner.Suggest(mine, nwc, "STC", "NWC");

        Assert.NotNull(s);
        Assert.Equal(DateOnly.Parse("2026-12-10"), s.SuggestedStartDate);
        Assert.Equal(DateOnly.Parse("2026-12-24"), s.SuggestedEndDate);
        Assert.Equal(mine.DurationDays, new DateRange(s.SuggestedStartDate, s.SuggestedEndDate).DurationDays);
        Assert.Contains("STC", s.Message);
        Assert.Contains("NWC", s.Message);
    }

    [Fact]
    public void When_I_start_later_the_suggestion_keeps_my_start()
    {
        var mine = R("2026-12-12", "2026-12-14");
        var other = R("2026-12-10", "2026-12-20");

        var s = DigOncePlanner.Suggest(mine, other, "A", "B")!;

        Assert.Equal(DateOnly.Parse("2026-12-12"), s.SuggestedStartDate);
        Assert.Equal(DateOnly.Parse("2026-12-14"), s.SuggestedEndDate);
    }

    [Fact]
    public void No_suggestion_without_a_time_overlap()
    {
        var mine = R("2026-12-01", "2026-12-05");
        var other = R("2026-12-10", "2026-12-20");

        Assert.Null(DigOncePlanner.Suggest(mine, other, "A", "B"));
    }
}
