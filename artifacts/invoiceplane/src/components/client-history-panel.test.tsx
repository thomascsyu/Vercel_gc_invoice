import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientHistoryPanel } from "./client-history-panel";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: fetchApi }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  const year = new Date().getFullYear();
  fetchApi.mockImplementation((url: string) =>
    Promise.resolve(
      url.startsWith("/api/invoices")
        ? {
            data: [
              { id: "i1", invoiceNumber: "2609001", invoiceDate: `${year}-01-15`, total: 9000, currency: "HKD", status: "paid" },
            ],
            total: 1,
          }
        : {
            data: [
              { id: "q1", quotationNumber: "Q2601", quotationDate: `${year}-02-01`, total: 27000, currency: "HKD", status: "sent" },
              { id: "q2", quotationNumber: "Q2002", quotationDate: `${year - 6}-02-01`, total: 5000, currency: "HKD", status: "confirmed", convertedInvoiceId: "x" },
            ],
            total: 2,
          },
    ),
  );
});

function renderPanel(clientId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ClientHistoryPanel clientId={clientId} />
    </QueryClientProvider>,
  );
}

it("asks for a client before loading anything", () => {
  renderPanel("");
  expect(screen.getByText(/Select a client/)).toBeTruthy();
  expect(fetchApi).not.toHaveBeenCalled();
});

it("lists invoices from the last four years and drops older quotations", async () => {
  renderPanel("client-1");
  expect(await screen.findByText("2609001")).toBeTruthy();
  const invoiceUrl = fetchApi.mock.calls.map(([u]) => u as string).find((u) => u.startsWith("/api/invoices"))!;
  expect(invoiceUrl).toContain("clientId=client-1");
  expect(invoiceUrl).toContain("dateFrom=");

  fireEvent.mouseDown(await screen.findByRole("tab", { name: /Quotations \(1\)/ }));
  expect(await screen.findByText("Q2601")).toBeTruthy();
  expect(screen.queryByText("Q2002")).toBeNull();
});
