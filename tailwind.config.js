/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './index.html',
        './home.html',
        './layout.html',
        './capture.html',
        './retake.html',
        './template.html',
        './filter.html',
        './payment.html',
        './processing.html',
        './print.html',
        './admin.html',
        './template-editor.html',
        './public/shared.js'
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                gray: {
                    900: '#0A0A0A',
                    500: '#676767',
                    400: '#8E8E8E',
                    100: '#E3E3E3',
                    50: '#F0F0F0',
                    0: '#FFFFFF'
                },
                accent: {
                    mint: '#BAFF66',
                    blue: '#4C65FF',
                    coral: '#FF6B57'
                }
            },
            fontFamily: {
                sans: ['Inter', 'Prompt', 'sans-serif']
            }
        }
    },
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/container-queries')
    ]
};
