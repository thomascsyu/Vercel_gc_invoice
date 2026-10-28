import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DocumentForm from "./document-form";

const { fetchApi, toast } = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({ customFetch: fetchApi }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/client-combobox", () => ({
  ClientCombobox: () => <div>Client</div>,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  fetchApi.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("next-number")
        ? { invoiceNumber: "2609001" }
        : { available: true },
    ),
  );
});
function form() {
  const onSubmit = vi.fn();
  const view = render(
    <DocumentForm
      kind="invoice"
      statuses={["draft"]}
      initial={{
        clientId: "client-id",
        items: [{ name: "Consulting", quantity: 1, price: 100 }],
      }}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  return { onSubmit, ...view };
}
async function assignedInput() {
  const input = screen.getByLabelText("Invoice Number") as HTMLInputElement;
  await waitFor(() => expect(input.value).toBe("2609001"));
  return input;
}
it("displays the automatically assigned invoice number", async () => {
  form();
  expect((await assignedInput()).disabled).toBe(false);
});
it("allows editing and saving a unique invoice number", async () => {
  const { onSubmit } = form();
  fireEvent.change(await assignedInput(), {
    target: { value: " CUSTOM-123 " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceNumber: "CUSTOM-123" }),
    ),
  );
  expect(fetchApi).toHaveBeenLastCalledWith(
    "/api/invoices/number-availability?invoiceNumber=CUSTOM-123",
  );
});
it("rejects duplicates before saving with the exact warning and retains the value", async () => {
  const { onSubmit } = form();
  const input = await assignedInput();
  fetchApi.mockResolvedValue({ available: false });
  fireEvent.change(input, { target: { value: "EXISTING-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Duplicate invoice number" }),
    ),
  );
  expect(onSubmit).not.toHaveBeenCalled();
  expect(input.value).toBe("EXISTING-123");
});
it("allows saving the assigned number when it is unique", async () => {
  const { onSubmit } = form();
  await assignedInput();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceNumber: "2609001" }),
    ),
  );
});
it("does not save when the availability check fails", async () => {
  const { onSubmit } = form();
  await assignedInput();
  fetchApi.mockRejectedValue(new Error("Offline"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not validate invoice number" }),
    ),
  );
  expect(onSubmit).not.toHaveBeenCalled();
});
it("does not overwrite typing when the number preview arrives late", async () => {
  let resolve!: (value: { invoiceNumber: string }) => void;
  fetchApi.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  form();
  const input = screen.getByLabelText("Invoice Number") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "MY-NUMBER" } });
  resolve({ invoiceNumber: "2609001" });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(input.value).toBe("MY-NUMBER");
});

it("preserves spaces between words while typing a line item description", async () => {
  form();
  await assignedInput();
  const desc = screen.getByLabelText("Line item description") as HTMLTextAreaElement;
  fireEvent.change(desc, { target: { value: "word " } });
  expect(desc.value).toBe("word ");
  fireEvent.change(desc, { target: { value: "word two" } });
  expect(desc.value).toBe("word two");
});

it("blocks submission while the assigned number is loading", async () => {
  let resolve!: (value: { invoiceNumber: string }) => void;
  fetchApi.mockReturnValue(new Promise((r) => { resolve = r; }));
  const { container, onSubmit } = form();
  fireEvent.change(screen.getByLabelText("Invoice Number"), { target: { value: "CUSTOM" } });
  fireEvent.submit(container.querySelector("form")!);
  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  resolve({ invoiceNumber: "2609001" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
});
