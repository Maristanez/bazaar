// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Gym } from "./Gym";

const policy = { floorPct: 25, askOwner: true, paused: false, updatedAt: "2026-09-19T12:00:00Z" };
const products = [{ productId: "p", title: "Trail Runner 2", image: "", listPrice: 14900, openToOffers: true, variants: [{ variantId: "v", size: "10", price: 14900, unitCost: 7800, inStock: true }], productType: "Trail Shoes", stockedAt: "2026-06-17", missingCost: false, missingStockedAt: false }];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Gym Console surface", () => {
  it("runs a bounded 300-shopper swarm and opens an authentic transcript from the keyboard", () => {
    render(<Gym products={products} policy={policy} />);
    fireEvent.click(screen.getByRole("button", { name: "Run the Gym" }));

    expect(screen.getByText(/300 synthetic shoppers/)).toBeTruthy();
    expect(screen.getByText(/deals missed/)).toBeTruthy();
    expect(screen.getByRole("list", { name: /Synthetic shopper price swarm/ })).toBeTruthy();
    const shoppers = screen.getAllByRole("listitem");
    expect(shoppers).toHaveLength(300);
    fireEvent.keyDown(shoppers[0]!, { key: "Enter" });
    expect(screen.getByText(/Shopper 1 ·/)).toBeTruthy();
    expect(screen.getAllByText(/Shopper offered/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Shopkeeper asked/).length).toBeGreaterThan(0);
  });

  it("recomputes a running preview when the policy draft changes without another run", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-19T12:00:00Z"));
    const { container, rerender } = render(<Gym products={products} policy={policy} />);
    fireEvent.click(screen.getByRole("button", { name: "Run the Gym" }));
    const before = container.querySelector(".gym-headline > b")?.textContent;

    rerender(<Gym products={products} policy={policy} draft={{ floorPct: 50, askOwner: false }} />);

    expect(screen.getByText("Candidate floor: cost + 50%")).toBeTruthy();
    expect(container.querySelector(".gym-compare")?.textContent).toContain("Candidate B · cost + 50%");
    expect(container.querySelector(".gym-headline > b")?.textContent).not.toBe(before);
    expect(screen.getByRole("button", { name: "Run again" })).toBeTruthy();
  });

  it("keeps unavailable inventory out of the simulation", () => {
    const missingCost = [{ ...products[0]!, variants: [{ ...products[0]!.variants[0]!, unitCost: null }] }];
    render(<Gym products={missingCost} policy={policy} />);

    expect(screen.getByText(/missing cost, so it is not open to offers/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run the Gym" }).hasAttribute("disabled")).toBe(true);
  });
});
