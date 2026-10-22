<script setup lang="ts">
// 计数小徽标（= MaterialBadge，已记录 N / 候选 N）：胶囊，accentSoft 底，onAccentSoft 字。
defineProps<{ count?: number }>();
</script>

<template>
  <span class="m-badge"><slot>{{ count }}</slot></span>
</template>
