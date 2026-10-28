import { useParams, useSearch } from "wouter";
import { useMemo } from "react";
import { apiUrl } from "@/lib/api-base";

function buildPdfUrl(id: string, token: string): string {
  return apiUrl(`/quotations/${id}/pdf/public?token=${encodeURIComponent(token)}`);
}

export default function QuotationPreview() {
  const params = useParams<{ id: string }>();
  const search = useSearch();
  const id = params.id;
  const searchParams = new URLSearchParams(search);
  const token = searchParams.get("token") ?? "";

  // Memoize PDF URL to prevent iframe reloads
  const pdfUrl = useMemo(() => {
    if (!id || !token) return "";
    return buildPdfUrl(id, token);
  }, [id, token]);

  if (!id || !token) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Invalid or missing share link. Please request a new link from the sender.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b shadow-sm">
        <span className="text-sm font-medium text-gray-700">Quotation Preview</span>
        <a
          href={pdfUrl}
          download
          className="text-sm text-blue-600 hover:underline"
        >
          Download PDF
        </a>
      </div>
      <iframe
        src={pdfUrl}
        className="flex-1 w-full border-0"
        title="Quotation PDF Preview"
      />
    </div>
  );
}
