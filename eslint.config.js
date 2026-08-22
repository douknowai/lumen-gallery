import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui 组件同时导出组件与 variants 工厂（如 buttonVariants），
    // 这是组件库的设计约束，需对 React Fast Refresh 规则豁免；
    // 其内部骨架屏随机宽度（sidebar）与 onSelect 初始化 state（carousel）
    // 亦触发 React 19 新规则，属第三方上游代码，一并豁免。
    files: ['**/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // R3F 命令式 3D：在 useFrame 渲染循环或初始化中直接修改 three.js 对象
    // （camera/material/texture/mesh）是 R3F 官方推荐模式，属于外部可变系统同步，
    // 并非 React 渲染副作用，需对 React 19 的 immutability 规则豁免。
    files: ['**/scene/**/*.{ts,tsx}', '**/systems/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/immutability': 'off',
    },
  },
])
