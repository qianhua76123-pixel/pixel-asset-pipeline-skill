import type { SourceGuidedImage } from "./image-types";
import { refineMaterialColors } from "./material-color-refinement";
import { refineContourDetails } from "./contour-detail-refinement";

export type DetailProfile = "foliage" | "bamboo" | "glass";
export const DETAIL_PROFILE_LABELS: Readonly<Record<DetailProfile, string>> = {
  foliage: "叶片残色", bamboo: "竹木描边", glass: "玻璃紫边",
};
export function normalizeDetailRefinementOptions(parameters: Readonly<Record<string, unknown>>): { profile: DetailProfile } {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || typeof parameters.profile !== "string" || !Object.hasOwn(DETAIL_PROFILE_LABELS, parameters.profile)) throw new Error("请选择叶片、竹木或玻璃精修方式");
  return { profile: parameters.profile as DetailProfile };
}
/** Explicit material choice; no global style conversion or inferred semantic label. */
export function refineImageDetails(image: SourceGuidedImage, parameters: Readonly<Record<string, unknown>>) {
  const { profile } = normalizeDetailRefinementOptions(parameters);
  const result = profile === "bamboo" ? refineContourDetails(image) : refineMaterialColors(image, { profile });
  return { image: result.image, diagnostics: { ...result.diagnostics, profile, materialSelectedByUser: true } };
}
