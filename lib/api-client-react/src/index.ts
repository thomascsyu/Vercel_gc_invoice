export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter, customFetch } from "./custom-fetch";
export { fetchWithSessionRetry, refreshAccessSession } from "./sessionRefresh";
export type {
  AuthTokenGetter,
  CustomFetchOptions,
  ErrorType,
  BodyType,
} from "./custom-fetch";

import { useMutation } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export const useReorderQuotationTemplates = () => {
  return useMutation({
    mutationFn: ({ data }: { data: { ids: string[] } }) =>
      customFetch<void>("/api/quotation-templates/reorder", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
};
