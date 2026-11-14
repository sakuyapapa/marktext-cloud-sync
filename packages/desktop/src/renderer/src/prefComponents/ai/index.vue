<template>
  <div class="pref-ai">
    <h4>{{ t('preferences.ai.title') }}</h4>
    <p class="notes">
      {{ t('preferences.ai.description') }}
    </p>

    <compound>
      <template #head>
        <h6 class="title">
          {{ t('preferences.ai.provider.title') }}
        </h6>
      </template>
      <template #children>
        <div class="row">
          <el-switch v-model="form.enabled" />
          <span class="row-label">{{ t('preferences.ai.provider.enabled') }}</span>
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.ai.provider.baseUrl') }}</span>
          <el-input
            v-model="form.baseUrl"
            class="row-input"
            placeholder="https://api.deepseek.com/v1"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.ai.provider.model') }}</span>
          <el-input
            v-model="form.model"
            class="row-input"
            placeholder="deepseek-chat"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.ai.provider.apiKey') }}</span>
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            class="row-input"
            :placeholder="hasKey ? t('preferences.ai.provider.apiKeySet') : 'sk-...'"
          />
        </div>
        <p class="notes">
          {{ t('preferences.ai.provider.hint') }}
        </p>
      </template>
    </compound>

    <compound>
      <template #head>
        <h6 class="title">
          {{ t('preferences.ai.params.title') }}
        </h6>
      </template>
      <template #children>
        <div class="row">
          <span class="row-label">{{ t('preferences.ai.params.temperature') }}</span>
          <el-input-number
            v-model="form.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            controls-position="right"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.ai.params.maxTokens') }}</span>
          <el-input-number
            v-model="form.maxTokens"
            :min="64"
            :max="8192"
            :step="128"
            controls-position="right"
          />
        </div>
      </template>
    </compound>

    <div class="actions">
      <el-button
        type="primary"
        :loading="saving"
        @click="save"
      >
        {{ t('preferences.ai.actions.save') }}
      </el-button>
      <el-button
        :loading="testing"
        @click="test"
      >
        {{ t('preferences.ai.actions.test') }}
      </el-button>
    </div>

    <el-alert
      v-if="feedback"
      class="feedback"
      :title="feedback.text"
      :type="feedback.type"
      :closable="false"
      show-icon
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Compound from '../common/compound/index.vue'
import type { AiConfig } from '@shared/types/ai'

const { t } = useI18n()

const form = reactive<AiConfig>({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.3,
  maxTokens: 2048
})

const saving = ref(false)
const testing = ref(false)
const hasKey = ref(false)
const feedback = ref<{ text: string; type: 'success' | 'warning' | 'error' | 'info' } | null>(null)

const applyConfig = (config: AiConfig): void => {
  form.enabled = config.enabled
  form.baseUrl = config.baseUrl
  form.model = config.model
  form.temperature = config.temperature
  form.maxTokens = config.maxTokens
  hasKey.value = !!config.apiKey
  // Never mirror the stored secret into the field; an empty value keeps it.
  form.apiKey = ''
}

const save = async (): Promise<void> => {
  saving.value = true
  try {
    const payload = { ...form }
    if (!payload.apiKey) delete (payload as Partial<AiConfig>).apiKey
    const saved = await window.electron.ipcRenderer.invoke('mt::ai::set-config', payload)
    applyConfig(saved)
    feedback.value = { text: t('preferences.ai.feedback.saved'), type: 'success' }
  } catch (error) {
    feedback.value = { text: error instanceof Error ? error.message : String(error), type: 'error' }
  } finally {
    saving.value = false
  }
}

const test = async (): Promise<void> => {
  testing.value = true
  try {
    // Save first so the test uses what the user just typed.
    await save()
    const result = await window.electron.ipcRenderer.invoke('mt::ai::test')
    feedback.value = { text: result.message, type: result.ok ? 'success' : 'error' }
  } catch (error) {
    feedback.value = { text: error instanceof Error ? error.message : String(error), type: 'error' }
  } finally {
    testing.value = false
  }
}

onMounted(async () => {
  const config = await window.electron.ipcRenderer.invoke('mt::ai::get-config')
  applyConfig(config)
})
</script>

<style scoped>
.pref-ai .row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-size: 14px;
  color: var(--editorColor);
}

.pref-ai .row-label {
  min-width: 150px;
  user-select: none;
}

.pref-ai .row-input {
  flex: 1;
  max-width: 520px;
}

.pref-ai .actions {
  display: flex;
  gap: 10px;
  margin: 20px 0 10px;
}

.pref-ai .feedback {
  max-width: 720px;
}
</style>
