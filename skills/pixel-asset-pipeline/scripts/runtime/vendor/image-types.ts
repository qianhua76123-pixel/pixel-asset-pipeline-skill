export interface SourceGuidedImage { data: Uint8ClampedArray; width: number; height: number }
export class StudioError extends Error { constructor(message: string, public status = 400) { super(message); this.name = "StudioError"; } }
