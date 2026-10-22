<script setup lang="ts">
// 多音字读音小按钮（= MarkChips.swift 的 FlowChips / 桌面 .deduce-poly-chip）：流式换行、每行居中，选中态带对勾。
import { formatReading, formatReadingDigit, readingKey, type CharData } from "../../core";
import { MChip } from "../ui";

defineProps<{ readings: CharData[]; current: CharData }>();
const emit = defineEmits<{ pick: [reading: CharData] }>();
</script>

<template>
  <div class="dd-poly">
    <MChip
      v-for="r in readings"
      :key="readingKey(r)"
      variant="poly"
      :active="readingKey(r) === readingKey(current)"
      :title="`切换为 ${formatReadingDigit(r)}`"
      @click="emit('pick', r)"
    >
      {{ formatReading(r) }}
    </MChip>
  </div>
</template>
