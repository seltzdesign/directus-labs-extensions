// CORE CLONE
export interface LayoutOptions {
	widths?: {
		[field: string]: number;
	};
	align?: {
		[field: string]: 'left' | 'center' | 'right';
	};
	limit?: number;
	spacing?: 'comfortable' | 'cozy' | 'compact';
	parent?: string | null;
	// When true (default), a row click opens the item in a slide-in drawer instead of
	// navigating to the full-page item route — keeps the list mounted so scroll survives.
	editInDrawer?: boolean;
}

export interface LayoutQuery {
	fields: string[];
	sort: string[];
	page: number;
	limit: number;
}
