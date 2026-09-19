import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/", "dist/"],
  },
  {
    files: ["src/app/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        alert: "readonly",
        console: "readonly",
        FormData: "readonly",
      },
    },
  },
);
