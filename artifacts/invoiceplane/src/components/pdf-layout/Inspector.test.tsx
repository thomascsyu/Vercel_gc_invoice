import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Inspector } from "./Inspector";
import type { CompanySettings, PdfDocumentProfile } from "@/lib/modulesApi";

afterEach(cleanup);

it("allows typing an upward title offset beyond the old server limit and resets it", () => {
  function Editor() {
    const [draft, setDraft] = useState<PdfDocumentProfile>({});
    return <Inspector kind="invoice" draft={draft} onChange={setDraft} settings={{
      logoUrl: "/logo.png", headerLogoUrl: "/header.png", companyLogoScale: 2, headerLogoScale: 2,
    } as CompanySettings} />;
  }
  render(<Editor />);
  const y = screen.getByLabelText("Y (up / down)") as HTMLInputElement;
  fireEvent.change(y, { target: { value: "-200" } });
  fireEvent.blur(y);
  expect((screen.getByLabelText("Y (up / down)") as HTMLInputElement).value).toBe("-200");
  fireEvent.click(screen.getByText("Reset positions"));
  expect((screen.getByLabelText("Y (up / down)") as HTMLInputElement).value).toBe("0");
});

it("clamps entered positions to the real unbranded page edge", () => {
  function Editor() {
    const [draft, setDraft] = useState<PdfDocumentProfile>({});
    return <Inspector kind="receipt" draft={draft} onChange={setDraft} />;
  }
  render(<Editor />);
  const y = screen.getByLabelText("Y (up / down)");
  fireEvent.change(y, { target: { value: "-200" } });
  fireEvent.blur(y);
  expect((screen.getByLabelText("Y (up / down)") as HTMLInputElement).value).toBe("-45");
});
