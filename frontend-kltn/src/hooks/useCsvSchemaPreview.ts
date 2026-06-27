import { useMutation } from "@tanstack/react-query";
import { previewCsvSchema } from "../api/endpoint";
import type { CsvSchemaPreviewResponse } from "../types";

export type CsvSchemaPreviewParams = {
  file: File;
  targetLabel?: string;
};

export function useCsvSchemaPreview() {
  return useMutation<
    CsvSchemaPreviewResponse,
    unknown,
    CsvSchemaPreviewParams
  >({
    mutationFn: ({ file, targetLabel }) => {
      const fd = new FormData();
      fd.append("file", file);
      if (targetLabel) fd.append("targetLabel", targetLabel);
      return previewCsvSchema(fd);
    },
  });
}
