import type { Field, Filter, Item, PrimaryKey } from '@directus/types';
import type { ComputedRef, Ref } from 'vue';
import type { HeaderRaw, Sort } from './core-clones/components/v-table/types';
import type { LayoutOptions, LayoutQuery } from './types';
import {
	defineLayout,
	useApi,
	useCollection,
	useExtensions,
	useItems,
	useStores,
	useSync,
} from '@directus/extensions-sdk';
import { getEndpoint } from '@directus/utils';
import { debounce, flatten } from 'lodash';
import {
	computed,

	provide,
	ref,

	toRefs,
	unref,
	watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import Actions from './actions.vue';
// CORE IMPORTS
import { useAliasFields } from './core-clones/composables/use-alias-fields';
import { useLayoutClickHandler } from './core-clones/composables/use-layout-click-handler';
import { adjustFieldsForDisplays } from './core-clones/utils/adjust-fields-for-displays';
import { formatItemsCountPaginated } from './core-clones/utils/format-items-count';
import { getDefaultDisplayForType } from './core-clones/utils/get-default-display-for-type';
import { hideDragImage } from './core-clones/utils/hide-drag-image';
import { saveAsCSV } from './core-clones/utils/save-as-csv';
import { syncRefProperty } from './core-clones/utils/sync-ref-property';
import Layout from './layout.vue';
import Options from './options.vue';

export default defineLayout<LayoutOptions, LayoutQuery>({
	id: 'directus-labs-tree-view-table-layout',
	name: 'Tree View Table',
	icon: 'format_indent_increase',
	component: Layout,
	slots: {
		options: Options,
		sidebar: () => {},
		actions: Actions,
	},
	headerShadow: false,
	setup(props, { emit }) {
		const system = { stores: useStores(), extensions: useExtensions() };
		provide('system', system);

		const { useFieldsStore } = system.stores;
		const fieldsStore = useFieldsStore();

		const selection = useSync(props, 'selection', emit);
		const layoutOptions = useSync(props, 'layoutOptions', emit);
		const layoutQuery = useSync(props, 'layoutQuery', emit);

		// Edit-in-drawer: open the clicked row in a slide-in drawer (Directus' core drawer-item,
		// globally registered) instead of navigating to the full-page item route. The list stays
		// mounted behind the drawer, so scroll position is preserved. Toggleable, default on.
		const editInDrawer = syncRefProperty(layoutOptions, 'editInDrawer', true);
		const editActive = ref(false);
		const editPrimaryKey = ref<PrimaryKey | null>(null);

		const { collection, filter, filterSystem, filterUser, search } =
            toRefs(props);

		const {
			info,
			primaryKeyField,
			fields: fieldsInCollection,
			sortField,
		} = useCollection(collection);

		// "Group by hierarchy" sort — the H1 -> H2 -> H3 -> H4 -> Order multi-key order that mirrors
		// the codegen parser's natural order. It's the default sort in flat mode, and the Actions-bar
		// "Group" button re-applies it after a single-column header click. Directus REPLACES the sort
		// on each header click instead of stacking it like a spreadsheet, so a button is the only way
		// back to the grouped view. Tree mode (proui) already groups by parent, so it's skipped there.
		const GROUP_SORT_FIELDS = ['h1', 'h2', 'h3', 'h4', 'order'];
		function groupSortForCollection(): string[] | null {
			const grouped = GROUP_SORT_FIELDS.filter(
				(f) => fieldsInCollection.value?.some((fc: any) => fc.field === f),
			);
			return !layoutOptions.value?.parent && grouped.length ? grouped : null;
		}
		const groupSortAvailable = computed(() => groupSortForCollection() !== null);
		function applyGroupSort() {
			const grouped = groupSortForCollection();
			if (grouped) sort.value = grouped;
		}

		const { sort, limit, page, fields } = useItemOptions();

		const { aliasedFields, aliasQuery, aliasedKeys } = useAliasFields(
			fields,
			collection,
			system,
		);

		const fieldsWithRelationalAliased = computed(() =>
			flatten(
				Object.values(aliasedFields.value).map(({ fields }) => fields),
			),
		);

		const { parentField, fieldsToQuery } = useTreeViewFieldsToQuery({
			fieldsWithRelationalAliased,
			primaryKeyField,
			sortField,
		});

		const { onClick: onClickDefault } = useLayoutClickHandler({
			props,
			selection,
			primaryKeyField,
		});

		const {
			items,
			loading,
			error,
			totalPages,
			itemCount,
			totalCount,
			getItems,
			getItemCount,
			getTotalCount,
		} = useItems(collection, {
			sort,
			limit,
			page,
			fields: fieldsToQuery,
			alias: aliasQuery,
			filter,
			search,
			filterSystem,
		});

		const {
			tableSort,
			tableHeaders,
			tableRowHeight,
			onSortChange,
			onAlignChange,
			activeFields,
			tableSpacing,
		} = useTable();

		const showingCount = computed(() => {
			// Don't show count if there are no items
			if (!totalCount.value || !itemCount.value)
				return;

			return formatItemsCountPaginated({
				currentItems: itemCount.value,
				currentPage: page.value,
				perPage: 25, // limit.value,
				isFiltered: !!filterUser.value,
				totalItems: totalCount.value,
			});
		});

		const { isFiltered } = useFilteringTreeView({ filterUser, search });

		const { saveEdits } = useSaveEdits();
		const { duplicateSelected, duplicating, canDuplicate, renameSelected, renaming, canRename } = useRowOps();

		return {
			tableHeaders,
			items,
			loading,
			error,
			totalPages,
			tableSort,
			onRowClick,
			editActive,
			editPrimaryKey,
			editInDrawer,
			groupSortAvailable,
			applyGroupSort,
			duplicateSelected,
			duplicating,
			canDuplicate,
			renameSelected,
			renaming,
			canRename,
			onSortChange,
			onAlignChange,
			tableRowHeight,
			page,
			toPage,
			itemCount,
			totalCount,
			fieldsInCollection,
			fields,
			limit,
			activeFields,
			tableSpacing,
			parentField,
			primaryKeyField,
			info,
			showingCount,
			sortField,
			hideDragImage,
			refresh,
			resetPresetAndRefresh,
			selectAll,
			filter,
			search,
			download,
			fieldsWithRelationalAliased,
			aliasedFields,
			aliasedKeys,
			saveEdits,
			isFiltered,
		};

		async function resetPresetAndRefresh() {
			await props?.resetPreset?.();
			refresh();
		}

		function refresh() {
			getItems();
			getTotalCount();
			getItemCount();
		}

		function download() {
			if (!collection.value)
				return;
			saveAsCSV(collection.value, fields.value, items.value, system);
		}

		function toPage(newPage: number) {
			page.value = newPage;
		}

		function selectAll() {
			if (!primaryKeyField.value)
				return;
			const pk = primaryKeyField.value;
			selection.value = items.value.map((item) => item[pk.field]);
		}

		// Row-click handler. When edit-in-drawer is on, open the clicked row in the drawer;
		// otherwise fall back to the default navigate/select behaviour. We defer to the default
		// for every case that isn't a plain edit-click — a modifier-click (open in new tab),
		// readonly, selection mode, or an active multi-selection — so nothing else regresses.
		function onRowClick({ item, event }: { item: Item; event: MouseEvent }) {
			const isPlainEditClick =
				editInDrawer.value
				&& !event.ctrlKey
				&& !event.metaKey
				&& props.readonly !== true
				&& !props.selectMode
				&& !(selection.value?.length > 0)
				&& !!primaryKeyField.value;

			if (isPlainEditClick) {
				editPrimaryKey.value = item[primaryKeyField.value!.field];
				editActive.value = true;
			}
			else {
				onClickDefault({ item, event });
			}
		}

		function useItemOptions() {
			const page = syncRefProperty(layoutQuery, 'page', 1);
			const limit = syncRefProperty(layoutQuery, 'limit', -1);

			const defaultSort = computed(() => {
				// Prefer the grouped hierarchy sort (H1 -> H4 -> Order) in flat mode; fall back to the
				// collection's sort field or primary key.
				const grouped = groupSortForCollection();
				if (grouped) return grouped;
				const field = sortField.value ?? primaryKeyField.value?.field;
				return field ? [field] : [];
			});

			const sort = syncRefProperty(layoutQuery, 'sort', defaultSort);

			const fieldsDefaultValue = computed(() => {
				return fieldsInCollection.value
					.filter(
						(field) =>
							!field.meta?.hidden
							&& !field.meta?.special?.includes('no-data'),
					)
					.slice(0, 4)
					.map(({ field }) => field)
					.sort();
			});

			const fields = computed({
				get() {
					return layoutQuery.value?.fields
						? layoutQuery.value.fields.filter((field) =>
								fieldsStore.getField(collection.value!, field),
							)
						: unref(fieldsDefaultValue);
				},
				set(value) {
					layoutQuery.value = Object.assign({}, layoutQuery.value, {
						fields: value,
					});
				},
			});

			const fieldsWithRelational = computed(() => {
				if (!props.collection)
					return [];
				return adjustFieldsForDisplays(
					fields.value,
					props.collection,
					system,
				);
			});

			return { sort, limit, page, fields, fieldsWithRelational };
		}

		function useTable() {
			const tableSort = computed(() => {
				if (!sort.value?.[0]) {
					return null;
				}
				else if (sort.value?.[0].startsWith('-')) {
					return { by: sort.value[0].slice(1), desc: true };
				}
				else {
					return { by: sort.value[0], desc: false };
				}
			});

			const localWidths = ref<{ [field: string]: number }>({});

			watch(
				() => layoutOptions.value,
				() => {
					localWidths.value = {};
				},
			);

			const saveWidthsToLayoutOptions = debounce(() => {
				layoutOptions.value = Object.assign({}, layoutOptions.value, {
					widths: localWidths.value,
				});
			}, 350);

			const activeFields = computed<(Field & { key: string })[]>({
				get() {
					if (!collection.value)
						return [];

					return fields.value
						.map((key) => ({
							...fieldsStore.getField(collection.value!, key),
							key,
						}))
						.filter(
							(f) =>
								f
								&& f.meta?.special?.includes('no-data') !== true,
						) as (Field & { key: string })[];
				},
				set(val) {
					fields.value = val.map((field) => field.field);
				},
			});

			const tableHeaders = computed<HeaderRaw[]>({
				get() {
					return activeFields.value.map((field) => {
						let description: string | null = null;

						const fieldParts = field.key.split('.');

						if (fieldParts.length > 1) {
							const fieldNames = fieldParts.map(
								(fieldKey, index) => {
									const pathPrefix = fieldParts.slice(
										0,
										index,
									);

									const field = fieldsStore.getField(
										collection.value!,
										[...pathPrefix, fieldKey].join('.'),
									);

									return field?.name ?? fieldKey;
								},
							);

							description = fieldNames.join(' -> ');
						}

						return {
							text: field.name,
							value: field.key,
							description,
							width:
                                localWidths.value[field.key]
                                || layoutOptions.value?.widths?.[field.key]
                                || null,
							align:
                                layoutOptions.value?.align?.[field.key]
                                || 'left',
							field: {
								display:
                                    field.meta?.display
                                    || getDefaultDisplayForType(field.type),
								displayOptions: field.meta?.display_options,
								interface: field.meta?.interface,
								interfaceOptions: field.meta?.options,
								type: field.type,
								field: field.field,
								collection: field.collection,
							},
							sortable:
                                ['json', 'alias', 'presentation', 'translations'].includes(field.type) === false,
						} as HeaderRaw;
					});
				},
				set(val) {
					const widths = {} as { [field: string]: number };

					for (const header of val) {
						if (header.width) {
							widths[header.value] = header.width;
						}
					}

					localWidths.value = widths;

					saveWidthsToLayoutOptions();

					fields.value = val.map((header) => header.value);
				},
			});

			const tableSpacing = syncRefProperty(
				layoutOptions,
				'spacing',
				'cozy',
			);

			const tableRowHeight = computed<number>(() => {
				switch (tableSpacing.value) {
					case 'compact':
						return 32;
					case 'comfortable':
						return 64;
					default:
						return 48;
				}
			});

			return {
				tableSort,
				tableHeaders,
				tableSpacing,
				tableRowHeight,
				onSortChange,
				onAlignChange,
				activeFields,
				getFieldDisplay,
			};

			function onSortChange(newSort: Sort | null) {
				if (!newSort?.by) {
					sort.value = [];
					return;
				}

				let sortString = newSort.by;

				if (newSort.desc === true) {
					sortString = `-${sortString}`;
				}

				sort.value = [sortString];
			}

			function onAlignChange(
				field: string,
				align: 'left' | 'center' | 'right',
			) {
				layoutOptions.value = Object.assign({}, layoutOptions.value, {
					align: {
						...layoutOptions.value?.align,
						[field]: align,
					},
				});
			}

			function getFieldDisplay(fieldKey: string) {
				const field = fieldsInCollection.value.find(
					(field: Field) => field.field === fieldKey,
				);

				if (!field?.meta?.display)
					return null;

				return {
					display: field.meta.display,
					options: field.meta.display_options,
				};
			}
		}

		function useTreeViewFieldsToQuery({
			fieldsWithRelationalAliased,
			primaryKeyField,
			sortField,
		}: {
			fieldsWithRelationalAliased: ComputedRef<string[]>;
			primaryKeyField: ComputedRef<Field | null>;
			sortField: ComputedRef<string | null>;
		}) {
			const parentField = syncRefProperty(layoutOptions, 'parent', null);

			const fieldsToQuery = computed(() => {
				const fieldsToQuery = fieldsWithRelationalAliased.value;
				addSortField();
				addParentField();

				return fieldsToQuery;

				function addSortField() {
					if (
						sortField.value
						&& !fieldsToQuery.includes(
							sortField.value,
						)
					) {
						fieldsToQuery.push(sortField.value);
					}
				}

				function addParentField() {
					if (
						parentField.value
						&& primaryKeyField.value
						&& !fieldsToQuery.some(
							(field) =>
								field === parentField.value
								|| field
								=== `${parentField.value}.${primaryKeyField.value?.field}`,
						)
					) {
						fieldsToQuery.push(
							`${parentField.value}.${primaryKeyField.value.field}`,
						);
					}
				}
			});

			watch(() => parentField.value, updateItemsOnNewParentQuery);

			return {
				parentField,
				fieldsToQuery,
			};

			function updateItemsOnNewParentQuery(
				newParentField: string | null | undefined,
			) {
				if (newParentField)
					refresh();
			}
		}

		function useFilteringTreeView({
			filterUser,
			search,
		}: {
			filterUser: Ref<Filter | null>;
			search: Ref<string | null | undefined>;
		}) {
			const isFiltered = computed(
				() => !!filterUser.value || !!search.value,
			);

			watch(() => isFiltered.value, turnOffManualSortOnFilter);

			return {
				isFiltered,
			};

			function turnOffManualSortOnFilter(filterIsActive: boolean) {
				if (filterIsActive)
					onSortChange(null);
			}
		}

		// Duplicate the selected row(s). Directus' built-in "Save as Copy" only lives in the full-page
		// item editor, which the drawer hides — so this brings duplication to the list where users look
		// for it (next to the batch delete). For a user-managed string key (e.g. parameters.name) the key
		// IS the identity and Directus can't rename it after creation, so we ask for the copy's name up
		// front (default "<name>Copy"); for an auto/uuid key the DB assigns one. Relational/alias/system
		// fields are skipped. A single duplicate opens in the drawer afterwards to tweak the other fields.
		function useRowOps() {
			const api = useApi();
			const duplicating = ref(false);
			const renaming = ref(false);
			// True when the DB assigns the key (auto-increment or uuid) — such keys are never renamed.
			const pkAutoAssigned = () => !!primaryKeyField.value?.schema?.has_auto_increment
				|| (primaryKeyField.value?.meta?.special ?? []).includes('uuid');
			const canDuplicate = computed(
				() => (selection.value?.length ?? 0) >= 1 && !!primaryKeyField.value,
			);
			// Rename only makes sense for ONE row with a user-managed (non-server-assigned) string key.
			const canRename = computed(
				() => (selection.value?.length ?? 0) === 1 && !!primaryKeyField.value && !pkAutoAssigned(),
			);

			// Fields we must NOT copy: relations/aliases (would duplicate children or send arrays) and
			// system-managed audit fields (Directus fills these itself on create).
			const SKIP_SPECIAL = ['o2m', 'm2m', 'o2a', 'm2a', 'alias', 'no-data', 'group', 'translations', 'file', 'files', 'user-created', 'user-updated', 'date-created', 'date-updated', 'version'];

			return { duplicateSelected, duplicating, canDuplicate, renameSelected, renaming, canRename };

			async function duplicateSelected() {
				if (duplicating.value || !selection.value?.length || !primaryKeyField.value) return;
				const endpoint = getEndpoint(collection.value!);
				const pkField = primaryKeyField.value.field;
				// A key we must generate a fresh value for is EITHER auto-increment OR a uuid special
				// (Directus auto-fills uuids) — in both cases we omit it and let the server assign.
				const serverAssignsPk = !!primaryKeyField.value.schema?.has_auto_increment
					|| (primaryKeyField.value.meta?.special ?? []).includes('uuid');
				const single = selection.value.length === 1;

				// A user-managed string key (e.g. parameters.name) IS the row's identity, and Directus
				// cannot rename it after creation (a PATCH silently keeps the old key). So for a single
				// duplicate we ask for the copy's name UP FRONT rather than letting the user try to rename
				// it in the drawer later (which fails silently). Cancel/empty = abort.
				let chosenName: string | null = null;
				if (!serverAssignsPk && single) {
					const base = String(selection.value[0]);
					const suggested = await uniqueName(endpoint, pkField, base);
					const input = typeof window !== 'undefined'
						? window.prompt(`Name for the copy of "${base}":`, suggested)
						: suggested;
					if (input == null) return;               // cancelled
					chosenName = input.trim();
					if (!chosenName) return;                  // empty
					if (await itemExists(endpoint, pkField, chosenName)) {
						const { useNotificationsStore } = system.stores;
						useNotificationsStore().add({ title: `"${chosenName}" already exists — pick another name.`, type: 'error' });
						return;
					}
				}

				duplicating.value = true;

				const copyable = (fieldsInCollection.value ?? [])
					.filter((f) => {
						const s = f.meta?.special ?? [];
						if (SKIP_SPECIAL.some((x) => s.includes(x))) return false;
						if (f.field === pkField && serverAssignsPk) return false;
						return true;
					})
					.map((f) => f.field);

				try {
					const pks = [...selection.value];
					let lastNewPk: PrimaryKey | null = null;
					for (const pk of pks) {
						const item = (await api.get(
							`${endpoint}/${encodeURIComponent(String(pk))}`,
							{ params: { fields: copyable.length ? copyable.join(',') : '*' } },
						)).data.data;

						const copy: Record<string, any> = {};
						for (const f of copyable) if (item[f] !== undefined && item[f] !== null) copy[f] = item[f];

						if (!serverAssignsPk) {
							// single: the name chosen in the prompt; multi: auto "<name>Copy" per row.
							copy[pkField] = chosenName ?? await uniqueName(endpoint, pkField, String(item[pkField]));
						}
						else {
							delete copy[pkField];
						}

						const created = (await api.post(endpoint, copy)).data.data;
						lastNewPk = created?.[pkField] ?? null;
					}

					selection.value = [];
					refresh();
					// One row duplicated -> open the copy in the drawer to rename/tweak immediately.
					if (pks.length === 1 && lastNewPk != null) {
						editPrimaryKey.value = lastNewPk;
						editActive.value = true;
					}
				}
				catch (error: any) {
					const { useNotificationsStore } = system.stores;
					useNotificationsStore().add({ title: 'Duplicate failed', type: 'error', dialog: true, error });
				}
				finally {
					duplicating.value = false;
				}
			}

			// Rename = create the row under the new key, re-point every FK that targets this collection
			// (e.g. proui.parameter) from old -> new, then delete the old row. Directus silently ignores a
			// primary-key change on PATCH, so a real move must recreate + repoint. Order matters (create ->
			// repoint -> delete) so references are never orphaned. Opens the renamed row in the drawer.
			async function renameSelected() {
				if (renaming.value || !canRename.value || !primaryKeyField.value) return;
				const endpoint = getEndpoint(collection.value!);
				const pkField = primaryKeyField.value.field;
				const oldName = String(selection.value![0]);
				const input = typeof window !== 'undefined' ? window.prompt(`Rename "${oldName}" to:`, oldName) : null;
				if (input == null) return;                    // cancelled
				const newName = input.trim();
				if (!newName || newName === oldName) return;   // empty / unchanged
				if (await itemExists(endpoint, pkField, newName)) {
					const { useNotificationsStore } = system.stores;
					useNotificationsStore().add({ title: `"${newName}" already exists — pick another name.`, type: 'error' });
					return;
				}

				renaming.value = true;
				try {
					// 1. create the row under the new key (must exist before we re-point FKs to it).
					const item = (await api.get(`${endpoint}/${encodeURIComponent(oldName)}`, { params: { fields: '*' } })).data.data;
					const copy: Record<string, any> = {};
					for (const f of fieldsInCollection.value ?? []) {
						const s = f.meta?.special ?? [];
						if (f.field === pkField || SKIP_SPECIAL.some((x) => s.includes(x))) continue;
						if (item[f.field] !== undefined && item[f.field] !== null) copy[f.field] = item[f.field];
					}
					copy[pkField] = newName;
					await api.post(endpoint, copy);
					// 2. re-point every relation that targets this collection's key: old -> new.
					await repointReferences(oldName, newName);
					// 3. drop the old row.
					await api.delete(`${endpoint}/${encodeURIComponent(oldName)}`);

					selection.value = [];
					refresh();
					editPrimaryKey.value = newName;
					editActive.value = true;
				}
				catch (error: any) {
					const { useNotificationsStore } = system.stores;
					useNotificationsStore().add({ title: 'Rename failed', type: 'error', dialog: true, error });
				}
				finally {
					renaming.value = false;
				}
			}

			// Update every FK that points at THIS collection's key (e.g. proui.parameter -> parameters.name)
			// from oldVal to newVal, one bulk update per relation. Runs BEFORE the old row is deleted so
			// placements are never orphaned.
			async function repointReferences(oldVal: string, newVal: string) {
				const all = (await api.get('/relations')).data.data ?? [];
				const rels = all.filter((r: any) => r.related_collection === collection.value && r.collection && r.field);
				for (const r of rels) {
					await api.patch(getEndpoint(r.collection), {
						query: { filter: { [r.field]: { _eq: oldVal } } },
						data: { [r.field]: newVal },
					});
				}
			}

			// Speed -> SpeedCopy -> SpeedCopy2 -> ... first name the server doesn't already have.
			async function uniqueName(endpoint: string, pkField: string, base: string) {
				for (let n = 1; n < 500; n++) {
					const candidate = n === 1 ? `${base}Copy` : `${base}Copy${n}`;
					try {
						await api.get(`${endpoint}/${encodeURIComponent(candidate)}`, { params: { fields: pkField } });
						// 200 -> taken, keep going
					}
					catch {
						return candidate; // 403/404 -> free
					}
				}
				return `${base}Copy${pkField}`; // improbable fallback
			}

			async function itemExists(endpoint: string, pkField: string, name: string) {
				try {
					await api.get(`${endpoint}/${encodeURIComponent(name)}`, { params: { fields: pkField } });
					return true;   // 200 -> exists
				}
				catch {
					return false;  // 403/404 -> free
				}
			}
		}

		function useSaveEdits() {
			const api = useApi();
			const { unexpectedError } = useUnexpectedError();

			return { saveEdits };

			async function saveEdits(edits: Record<PrimaryKey, Item>) {
				const pk = primaryKeyField.value?.field ?? 'id';
				const parentFieldName = parentField.value;
				// Normalise an m2o value (object {pk}, scalar, or null) to its related key for comparison.
				const relKey = (value: any) =>
					value == null ? null : (typeof value === 'object' ? value[pk] : value);

				// Only PATCH rows whose value actually changed. Upstream re-patches EVERY row's sort
				// key on any drag (600+ requests), which is slow and lets a fast reload race a
				// reparent queued behind those writes. We also send parent edits first so a reparent
				// persists immediately, before the (now minimal) sort-position updates.
				const entries = Object.entries(edits).sort(([, a], [, b]) => {
					const aParent = parentFieldName && parentFieldName in (a as object) ? 0 : 1;
					const bParent = parentFieldName && parentFieldName in (b as object) ? 0 : 1;
					return aParent - bParent;
				});

				try {
					for (const [id, payload] of entries) {
						const original = items.value.find(
							(item) => String(item[pk]) === String(id),
						);

						const changed: Item = {};

						for (const [field, value] of Object.entries(payload)) {
							const isParent = field === parentFieldName;
							const before = isParent ? relKey(original?.[field]) : original?.[field];
							const after = isParent ? relKey(value) : value;

							if (original === undefined || before !== after)
								changed[field] = value;
						}

						if (Object.keys(changed).length > 0) {
							await api.patch(
								`${getEndpoint(collection.value!)}/${id}`,
								changed,
							);
						}
					}
				}
				catch (error: any) {
					unexpectedError(error);
				}

				refresh();
			}

			// Based from the core: /app/src/utils/unexpected-error.ts
			function useUnexpectedError() {
				const { useNotificationsStore } = system.stores;
				const notificationStore = useNotificationsStore();
				const { t } = useI18n();

				return {
					unexpectedError(error: any) {
						const code =
                            error.response?.data?.errors?.[0]?.extensions?.code || error?.extensions?.code || 'UNKNOWN';

						notificationStore.add({
							title: t(`errors.${code}`),
							type: 'error',
							code,
							dialog: true,
							error,
						});
					},
				};
			}
		}
	},
});
