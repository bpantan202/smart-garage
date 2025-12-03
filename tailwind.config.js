/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"   // <- scan everything inside src/
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}