<script setup lang="ts">
defineOptions({ inheritAttrs: false });

defineProps<{
	showingCount?: string;
	groupSortAvailable?: boolean;
	applyGroupSort?: () => void;
}>();
</script>

<template>
	<v-button
		v-if="groupSortAvailable"
		v-tooltip.bottom="'Group by hierarchy: sort by H1 → H2 → H3 → H4 → Order'"
		class="group-sort"
		x-small
		secondary
		@click="applyGroupSort?.()"
	>
		<v-icon name="account_tree" small left />
		Group
	</v-button>
	<transition name="fade">
		<span
			v-if="showingCount"
			class="item-count"
		>
			{{ showingCount }}
		</span>
	</transition>
</template>

<style lang="scss" scoped>
    .item-count {
	position: relative;
	display: none;
	margin: 0 8px;
	color: var(--theme--foreground-subdued);
	white-space: nowrap;

	@media (min-width: 600px) {
		display: inline;
	}
}

.fade-enter-active,
.fade-leave-active {
	transition: opacity var(--medium) var(--transition);
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
</style>
