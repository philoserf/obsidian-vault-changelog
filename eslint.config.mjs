import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

export default [
	{
		ignores: ["node_modules", "dist", "main.js"],
	},
	{
		files: ["**/*.ts"],
		plugins: {
			"@typescript-eslint": typescriptEslint,
		},
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: "./tsconfig.json",
			},
		},
		rules: {
			...typescriptEslint.configs.recommended.rules,
			...prettier.rules,
		},
	},
];
