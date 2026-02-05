import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        plugins: {
            prettier,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            'prettier/prettier': 'error',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/explicit-function-return-type': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                },
            ],
        },
    }
);
