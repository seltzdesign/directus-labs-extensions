<!-- eslint-disable perfectionist/sort-named-imports -->
<script setup lang="ts">
import type { ShowSelect } from '@directus/extensions';
import type { Field, Filter, Item, PrimaryKey } from '@directus/types';
import type { ComponentPublicInstance, Ref } from 'vue';
// CORE CLONES
import type { HeaderRaw } from './core-clones/components/v-table/types';
import type { AliasFields } from './core-clones/composables/use-alias-fields';
import type { Collection } from './core-clones/types/collections';
// CORE CHANGES
// import { useSync } from '@directus/composables';
// import { useCollectionPermissions } from '@/composables/use-permissions';
import { useSync } from '@directus/extensions-sdk';
import {
	inject,
	onBeforeUnmount,
	ref,
	toRefs,
	watch,
	computed,

} from 'vue';
import { useI18n } from 'vue-i18n';
// CUSTOMIZED TABLE COMPONENT
import CustomVTable from './components/v-table.vue';
import { useAliasFields } from './core-clones/composables/use-alias-fields';
import { usePageSize } from './core-clones/composables/use-page-size';
import { useShortcut } from './core-clones/composables/use-shortcut';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<Props>(), {
	selection: () => [],
	showSelect: 'none',
	error: null,
	itemCount: undefined,
	tableSort: undefined,
	primaryKeyField: undefined,
	info: undefined,
	sortField: undefined,
	filterUser: undefined,
	search: undefined,
	onAlignChange: () => {},
});

const emit = defineEmits([
	'update:selection',
	'update:tableHeaders',
	'update:limit',
	'update:fields',
	'update:editActive',
]);

interface Props {
	collection: string;
	selection?: Item[];
	readonly: boolean;
	tableHeaders: HeaderRaw[];
	showSelect?: ShowSelect;
	items: Item[];
	loading: boolean;
	error?: any;
	totalPages: number;
	tableSort?: { by: string; desc: boolean } | null;
	onRowClick: ({ item, event }: { item: Item; event: PointerEvent }) => void;
	tableRowHeight: number;
	page: number;
	toPage: (newPage: number) => void;
	itemCount?: number;
	fields: string[];
	limit: number;
	primaryKeyField?: Field;
	info?: Collection;
	sortField?: string;
	resetPresetAndRefresh: () => Promise<void>;
	selectAll: () => void;
	filterUser?: Filter;
	search?: string;
	aliasedFields: Record<string, AliasFields>;
	aliasedKeys: string[];
	onSortChange: (newSort: { by: string; desc: boolean }) => void;
	onAlignChange?: (field: 'string', align: 'left' | 'center' | 'right') => void;
	parentField: string | null;
	saveEdits: (edits: Record<PrimaryKey, Item>) => void;
	isFiltered: boolean;
	editActive: boolean;
	editPrimaryKey: PrimaryKey | null;
}

const { t } = useI18n();
const { collection } = toRefs(props);

// CORE CHANGE
const system = inject<Record<string, any>>('system')!;

// CORE CHANGES
const { sortAllowed } = useCollectionPermissions(collection);

function useCollectionPermissions(collection: Ref<string>) {
	const { usePermissionsStore, useUserStore } = system.stores;
	const permissionsStore = usePermissionsStore();
	const userStore = useUserStore();

	const sortAllowed = computed(() => {
		if (!collection.value || !props.sortField) return false;

		if (userStore.isAdmin) return true;

		const permission = permissionsStore.getPermission(collection.value, 'update');
		if (!permission) return false;

		if (!permission.fields) return false;
		return permission.fields.includes('*') || permission.fields.includes(props.sortField);
	});

	return { sortAllowed };
}

const selectionWritable = useSync(props, 'selection', emit);
const tableHeadersWritable = useSync(props, 'tableHeaders', emit);
const limitWritable = useSync(props, 'limit', emit);
const editActiveWritable = useSync(props, 'editActive', emit);

// drawer-item validates + emits its changed-fields delta on save (it does NOT persist), then
// closes itself. Route that delta through saveEdits, which PATCHes the changed fields and
// refreshes the row in place. Cancel/esc emit no `input`, so nothing is written on cancel.
// (A rare server-side rejection surfaces Directus' standard error dialog, same as its native
// full-page editor — we deliberately don't try to re-stage, since the drawer self-closes and
// the layout-slot two-way binding can't reliably re-open it.)
function onDrawerSave(edits: Record<string, any>) {
	if (props.editPrimaryKey == null)
		return;
	props.saveEdits({ [props.editPrimaryKey]: edits });
}

// The core drawer-item forces the drawer `persistent` (Directus hardcodes it to avoid accidental
// data loss), so clicking the dimmed backdrop does nothing. Users expect an outside-click to dismiss
// like ESC. While the drawer is open, close it on a backdrop-scrim click. We match the scrim
// precisely — the `.v-overlay` that sits beside our `.v-drawer` panel — so clicks inside the form,
// on its dropdown portals, or on the error dialog never trigger a close. Setting active=false is the
// same immediate discard-and-close ESC does (we don't set preventCancelWithEdits).
function onBackdropClick(event: MouseEvent) {
	const overlay = (event.target as HTMLElement | null)?.closest?.('.v-overlay');
	if (overlay && overlay.parentElement?.querySelector(':scope > .v-drawer'))
		editActiveWritable.value = false;
}

watch(editActiveWritable, (open) => {
	if (open)
		document.addEventListener('click', onBackdropClick, true);
	else
		document.removeEventListener('click', onBackdropClick, true);
});

onBeforeUnmount(() => document.removeEventListener('click', onBackdropClick, true));

// Remember which collapsible form sections (Directus "detail groups") the user had open, per
// collection. The core detail-group resets to its `start` default on every mount, so editing item
// after item always re-opened the same section. We persist the open set in localStorage and re-apply
// it whenever the drawer (re)opens, so the section layout carries across items. Default = all closed
// (the schema `start` is also set to closed, so there's no open-then-close flash). Purely a per-user
// view preference — never touches the item data.
const sectionsKey = () => `tvtl:openSections:${collection.value}`;

function drawerSections() {
	const drawer = document.querySelector('.v-drawer');
	if (!drawer)
		return [] as { header: HTMLElement; label: string; open: boolean }[];
	return [...drawer.querySelectorAll('.v-detail.group-detail')]
		.map((el) => {
			const header = el.querySelector('.v-divider') as HTMLElement | null;
			return { header, label: header?.textContent?.trim() ?? '', open: !!header?.classList.contains('active') };
		})
		.filter((s): s is { header: HTMLElement; label: string; open: boolean } => !!s.header && !!s.label);
}

function readSavedSections(): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(sectionsKey()) || '[]'));
	}
	catch {
		return new Set();
	}
}

function saveOpenSections() {
	const open = drawerSections().filter((s) => s.open).map((s) => s.label);
	try {
		localStorage.setItem(sectionsKey(), JSON.stringify(open));
	}
	catch { /* storage unavailable — best-effort preference only */ }
}

let sectionRaf = 0;
let sectionClickHandler: ((e: MouseEvent) => void) | null = null;
let applyingSections = false; // true while WE toggle, so our own clicks aren't mistaken for the user's
let userTookOver = false; // once the user toggles a section, stop re-applying and respect their choice

// Toggle each section to match the saved set.
function applySavedSections(saved: Set<string>) {
	applyingSections = true;
	for (const s of drawerSections()) {
		if (s.open !== saved.has(s.label))
			s.header.click();
	}
	applyingSections = false;
}

// Restore on open. The form loads async and can re-render the sections back to their `start`
// default AFTER a one-shot restore (the timing varies), so we re-apply the saved state every frame
// until the user takes over (or a ~3s safety cap). Saving is driven purely by real header CLICKS —
// the form's own programmatic resets never click, so they can't corrupt the saved preference.
function startSectionMemory() {
	const saved = readSavedSections();
	userTookOver = false;
	let frames = 0;
	const step = () => {
		if (!userTookOver && drawerSections().length)
			applySavedSections(saved);
		if (!userTookOver && frames++ < 180)
			sectionRaf = requestAnimationFrame(step);
	};
	sectionRaf = requestAnimationFrame(step);

	sectionClickHandler = (e: MouseEvent) => {
		if (applyingSections)
			return; // our own restore click, not the user's
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('.v-divider') && target.closest('.v-drawer')) {
			userTookOver = true; // hand control to the user for the rest of this open
			requestAnimationFrame(saveOpenSections); // let the toggled class settle first
		}
	};
	document.addEventListener('click', sectionClickHandler, true);
}

function stopSectionMemory() {
	cancelAnimationFrame(sectionRaf);
	if (sectionClickHandler)
		document.removeEventListener('click', sectionClickHandler, true);
	sectionClickHandler = null;
	applyingSections = false;
	userTookOver = false;
}

watch(editActiveWritable, (open) => (open ? startSectionMemory() : stopSectionMemory()));
onBeforeUnmount(stopSectionMemory);

// Lock the primary-key field inside the drawer: its value IS the row's identity and Directus can't
// rename it via an edit (a PATCH silently keeps the old key), so typing a new name here does nothing.
// Mark it non-interactive (class + readonly) so it's obvious you must use the Rename action instead.
// Existing rows only (data-primary-key !== '+') — the create form is untouched. The form re-renders
// async, so — like the section restore — we re-apply for a short window.
let pkLockRaf = 0;
function lockPrimaryKeyField() {
	const field = props.primaryKeyField?.field;
	if (!field)
		return;
	const wrap = document.querySelector(`.v-drawer [data-field="${field}"]`) as HTMLElement | null;
	if (!wrap || wrap.getAttribute('data-primary-key') === '+')
		return;
	wrap.classList.add('sm-pk-locked');
	if (!wrap.title)
		wrap.title = 'This is the ID — use the Rename button to change it (editing here won’t rename).';
	for (const el of wrap.querySelectorAll('input, textarea'))
		(el as HTMLInputElement).readOnly = true;
}
function startPkLock() {
	let frames = 0;
	const step = () => {
		lockPrimaryKeyField();
		if (frames++ < 180)
			pkLockRaf = requestAnimationFrame(step);
	};
	pkLockRaf = requestAnimationFrame(step);
}
function stopPkLock() {
	cancelAnimationFrame(pkLockRaf);
}
watch(editActiveWritable, (open) => (open ? startPkLock() : stopPkLock()));
onBeforeUnmount(stopPkLock);

const mainElement = inject<Ref<Element | undefined>>('main-element');

const table = ref<ComponentPublicInstance>();

watch(
	() => props.page,
	() => mainElement?.value?.scrollTo({ top: 0, behavior: 'smooth' }),
);

useShortcut(
	'meta+a',
	() => {
		props.selectAll();
	},
	table,
);

const { sizes: pageSizes, selected: selectedSize } = usePageSize<string>(
	[25, 50, 100, 250, 500, 1000],
	String,
	props.limit,
	system,
);

if (limitWritable.value !== selectedSize) {
	limitWritable.value = selectedSize;
}

const fieldsWritable = useSync(props, 'fields', emit);

const { getFromAliasedItem } = useAliasFields(
	fieldsWritable,
	collection,
	system,
);

function addField(fieldKey: string) {
	fieldsWritable.value = [...fieldsWritable.value, fieldKey];
}

function removeField(fieldKey: string) {
	fieldsWritable.value = fieldsWritable.value.filter(
		(field) => field !== fieldKey,
	);
}
</script>

<template>
	<div class="custom-layout">
		<CustomVTable
			v-if="loading || (itemCount && itemCount > 0 && !error)"
			ref="table"
			v-model="selectionWritable"
			v-model:headers="tableHeadersWritable"
			class="table"
			fixed-header
			:show-select="showSelect ? showSelect : selection !== undefined"
			show-resize
			must-sort
			:sort="tableSort"
			:items="items"
			:loading="loading"
			:row-height="tableRowHeight"
			:item-key="primaryKeyField?.field"
			:show-manual-sort="sortAllowed && !isFiltered"
			:manual-sort-key="sortField"
			allow-header-reorder
			selection-use-keys
			:parent-field
			:collection
			@click:row="onRowClick"
			@update:sort="onSortChange"
			@update:items="saveEdits"
		>
			<template
				v-for="header in tableHeaders"
				:key="header.value"
				#[`item.${header.value}`]="{ item }"
			>
				<render-display
					:value="getFromAliasedItem(item, header.value)"
					:display="header.field.display"
					:options="header.field.displayOptions"
					:interface="header.field.interface"
					:interface-options="header.field.interfaceOptions"
					:type="header.field.type"
					:collection="header.field.collection"
					:field="header.field.field"
				/>
			</template>

			<template #header-context-menu="{ header }">
				<v-list>
					<v-list-item
						:disabled="!header.sortable"
						:active="
							tableSort?.by === header.value && tableSort?.desc === false
						"
						clickable
						@click="onSortChange({ by: header.value, desc: false })"
					>
						<v-list-item-icon>
							<v-icon name="sort" class="flip" />
						</v-list-item-icon>
						<v-list-item-content>
							{{ t("sort_asc") }}
						</v-list-item-content>
					</v-list-item>

					<v-list-item
						:active="tableSort?.by === header.value && tableSort?.desc === true"
						:disabled="!header.sortable"
						clickable
						@click="onSortChange({ by: header.value, desc: true })"
					>
						<v-list-item-icon>
							<v-icon name="sort" />
						</v-list-item-icon>
						<v-list-item-content>
							{{ t("sort_desc") }}
						</v-list-item-content>
					</v-list-item>

					<v-divider />

					<v-list-item
						:active="header.align === 'left'"
						clickable
						@click="onAlignChange?.(header.value, 'left')"
					>
						<v-list-item-icon>
							<v-icon name="format_align_left" />
						</v-list-item-icon>
						<v-list-item-content>
							{{ t("left_align") }}
						</v-list-item-content>
					</v-list-item>
					<v-list-item
						:active="header.align === 'center'"
						clickable
						@click="onAlignChange?.(header.value, 'center')"
					>
						<v-list-item-icon>
							<v-icon name="format_align_center" />
						</v-list-item-icon>
						<v-list-item-content>
							{{ t("center_align") }}
						</v-list-item-content>
					</v-list-item>
					<v-list-item
						:active="header.align === 'right'"
						clickable
						@click="onAlignChange?.(header.value, 'right')"
					>
						<v-list-item-icon>
							<v-icon name="format_align_right" />
						</v-list-item-icon>
						<v-list-item-content>
							{{ t("right_align") }}
						</v-list-item-content>
					</v-list-item>

					<v-divider />

					<v-list-item
						:active="header.align === 'right'"
						clickable
						@click="removeField(header.value)"
					>
						<v-list-item-icon>
							<v-icon name="remove" />
						</v-list-item-icon>
						<v-list-item-content>
							{{ t("hide_field") }}
						</v-list-item-content>
					</v-list-item>
				</v-list>
			</template>

			<template #header-append>
				<v-menu
					placement="bottom-end"
					show-arrow
					:close-on-content-click="false"
				>
					<template #activator="{ toggle, active }">
						<v-icon
							v-tooltip="t('add_field')"
							class="add-field"
							name="add"
							:class="{ active }"
							clickable
							@click="toggle"
						/>
					</template>

					<v-field-list
						:collection="collection"
						:disabled-fields="fields"
						:allow-select-all="false"
						@add="addField($event[0])"
					/>
				</v-menu>
			</template>

			<template #footer>
				<div class="footer">
					<div class="pagination">
						<v-pagination
							v-if="totalPages > 1"
							:length="totalPages"
							:total-visible="7"
							show-first-last
							:model-value="page"
							@update:model-value="toPage"
						/>
					</div>

					<div
						v-if="
							loading === false
								&& limit > -1
								&& (items.length >= 25 || limit < 25)
						"
						class="per-page"
					>
						<span>{{ t("per_page") }}</span>
						<v-select
							:model-value="`${limit}`"
							:items="pageSizes"
							inline
							@update:model-value="limitWritable = +$event"
						/>
					</div>
				</div>
			</template>
		</CustomVTable>

		<slot
			v-else-if="error"
			name="error"
			:error="error"
			:reset="resetPresetAndRefresh"
		/>
		<slot
			v-else-if="itemCount === 0 && (filterUser || search)"
			name="no-results"
		/>
		<slot v-else-if="itemCount === 0" name="no-items" />

		<!-- Edit-in-drawer: Directus' globally-registered drawer-item renders the full item
		     form in a slide-in drawer. active is driven by a row click (see index.ts onRowClick);
		     on save it emits its delta to onDrawerSave. No v-if — v-model:active gates loading. -->
		<drawer-item
			v-model:active="editActiveWritable"
			:collection="collection"
			:primary-key="editPrimaryKey ?? '+'"
			@input="onDrawerSave"
		/>
	</div>
</template>

<style lang="scss" scoped>
.custom-layout {
	display: contents;
	margin: var(--content-padding);
	margin-bottom: var(--content-padding-bottom);
}

.v-table {
	--v-table-sticky-offset-top: var(--layout-offset-top);

	display: contents;

	& > :deep(table) {
		min-width: calc(100% - var(--content-padding) * 2) !important;
		margin-inline: var(--content-padding);
	}
}

.footer {
	position: sticky;
	left: 0;
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;
	padding: 32px var(--content-padding);

	.pagination {
		display: inline-block;
	}

	.per-page {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		width: 240px;
		color: var(--theme--foreground-subdued);

		span {
			width: auto;
			margin-right: 4px;
		}

		.v-select {
			color: var(--theme--foreground);
		}
	}
}

.add-field {
	--v-icon-color-hover: var(--theme--foreground);

	&.active {
		--v-icon-color: var(--theme--foreground);
	}
}

.flip {
	transform: scaleY(-1);
}
</style>

<!-- Non-scoped: the drawer-item is portalled outside this component, so scoped styles can't reach it.
     Locks the primary-key field's inputs (see lockPrimaryKeyField) — non-interactive + dimmed, with a
     small padlock, so it's obvious the identity can't be renamed here (use the Rename action). -->
<style>
.v-drawer .sm-pk-locked :is(input, textarea, .v-input, .input) {
	pointer-events: none;
}
.v-drawer .sm-pk-locked {
	opacity: 0.6;
}
.v-drawer .sm-pk-locked::after {
	content: "🔒 use Rename to change";
	display: block;
	margin-top: 4px;
	font-size: 12px;
	color: var(--theme--foreground-subdued, #a2a2a2);
}
</style>
