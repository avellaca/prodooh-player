/**
 * Property Test: ActiveDatesPicker bounds from parentOrder (Property 4)
 *
 * For any parentOrder.starts_at and parentOrder.ends_at values passed to OrderLineForm,
 * the ActiveDatesPicker component's minDate prop SHALL equal parentOrder.starts_at
 * and its maxDate prop SHALL equal parentOrder.ends_at.
 *
 * **Validates: Requirements 1.4**
 */

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { render } from "@testing-library/react";
import { OrderLineForm } from "../components/OrderLineForm";

// Mock ActiveDatesPicker to capture its props
let capturedProps: { minDate?: string; maxDate?: string } = {};

vi.mock("../components/ActiveDatesPicker", () => ({
  ActiveDatesPicker: (props: {
    value: string[];
    onChange: (dates: string[]) => void;
    minDate?: string;
    maxDate?: string;
    disabled?: boolean;
  }) => {
    capturedProps = { minDate: props.minDate, maxDate: props.maxDate };
    return (
      <div
        data-testid="active-dates-picker"
        data-min-date={props.minDate ?? ""}
        data-max-date={props.maxDate ?? ""}
      />
    );
  },
}));

// --- Generators ---

/** Generate a valid date pair where starts_at <= ends_at */
const datePairArb = fc
  .tuple(
    fc.integer({ min: 0, max: 3650 }), // start offset from baseline (days)
    fc.integer({ min: 0, max: 365 }) // duration in days
  )
  .map(([startOffset, duration]) => {
    const baseline = new Date("2020-01-01T00:00:00Z");
    const startDate = new Date(
      baseline.getTime() + startOffset * 24 * 60 * 60 * 1000
    );
    const endDate = new Date(
      startDate.getTime() + duration * 24 * 60 * 60 * 1000
    );

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    return {
      starts_at: formatDate(startDate),
      ends_at: formatDate(endDate),
    };
  });

// --- Property Tests ---

describe("Property 4: ActiveDatesPicker bounds reactivity", () => {
  it("minDate and maxDate props equal parentOrder starts_at and ends_at on initial render", () => {
    fc.assert(
      fc.property(datePairArb, ({ starts_at, ends_at }) => {
        capturedProps = {};

        const { unmount } = render(
          <OrderLineForm
            parentOrder={{ starts_at, ends_at }}
            onSubmit={() => {}}
          />
        );

        // The ActiveDatesPicker should receive parentOrder's starts_at/ends_at as bounds
        expect(capturedProps.minDate).toBe(starts_at);
        expect(capturedProps.maxDate).toBe(ends_at);

        unmount();
      }),
      { numRuns: 5 }
    );
  });

  it("minDate and maxDate reflect parentOrder prop for different date ranges", () => {
    fc.assert(
      fc.property(datePairArb, datePairArb, (range1, range2) => {
        capturedProps = {};

        // Render with first range
        const { unmount: unmount1 } = render(
          <OrderLineForm
            parentOrder={{ starts_at: range1.starts_at, ends_at: range1.ends_at }}
            onSubmit={() => {}}
          />
        );

        expect(capturedProps.minDate).toBe(range1.starts_at);
        expect(capturedProps.maxDate).toBe(range1.ends_at);

        unmount1();

        // Render with second range
        capturedProps = {};
        const { unmount: unmount2 } = render(
          <OrderLineForm
            parentOrder={{ starts_at: range2.starts_at, ends_at: range2.ends_at }}
            onSubmit={() => {}}
          />
        );

        expect(capturedProps.minDate).toBe(range2.starts_at);
        expect(capturedProps.maxDate).toBe(range2.ends_at);

        unmount2();
      }),
      { numRuns: 5 }
    );
  });
});
