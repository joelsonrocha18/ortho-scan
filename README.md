# React + TypeScript + Vite

Este template oferece uma configuração mínima para usar React no Vite com HMR e algumas regras do ESLint.

Atualmente, há dois plugins oficiais disponíveis:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) usa [Babel](https://babeljs.io/) ou [oxc](https://oxc.rs), quando usado com [rolldown-vite](https://vite.dev/guide/rolldown), para Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) usa [SWC](https://swc.rs/) para Fast Refresh

## Compilador React

O Compilador React não está habilitado neste template por causa do impacto no desempenho de desenvolvimento e build. Para adicioná-lo, consulte [esta documentação](https://react.dev/learn/react-compiler/installation).

## Expandindo a configuração do ESLint

Se estiver desenvolvendo uma aplicação de produção, recomendamos atualizar a configuração para habilitar regras de lint com análise de tipos:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Outras configurações...

      // Remova tseslint.configs.recommended e substitua por isto
      tseslint.configs.recommendedTypeChecked,
      // Como alternativa, use isto para regras mais rígidas
      tseslint.configs.strictTypeChecked,
      // Opcionalmente, adicione isto para regras de estilo
      tseslint.configs.stylisticTypeChecked,

      // Outras configurações...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // outras opções...
    },
  },
])
```

Também é possível instalar [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) e [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) para regras de lint específicas de React:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Outras configurações...
      // Habilita regras de lint para React
      reactX.configs['recommended-typescript'],
      // Habilita regras de lint para React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // outras opções...
    },
  },
])
```

## Deploy (Vercel)

### 1) Build local (checagem)

```bash
npm install
npm run build
```

### 2) Variáveis de ambiente na Vercel

- `VITE_DATA_MODE=local` para demo simples (dados no navegador)
- `VITE_DATA_MODE=firebase` para produção multiusuário
- Se usar Firebase, também configurar:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

### 3) Publicação

1. Suba este repositório no GitHub.
2. Na Vercel: `Adicionar novo projeto`.
3. Selecione o repo `arrimo-orthoscan-frontend`.
4. Comando de build: `npm run build`.
5. Diretório de saída: `dist`.
6. Faça o deploy.

### 4) Rotas SPA

O arquivo `vercel.json` já está configurado para fallback de rotas (`/app/*` -> `index.html`).
