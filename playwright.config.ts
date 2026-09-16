import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',timeout:180000,expect:{timeout:15000},use:{baseURL:process.env.BASE_URL??'http://localhost:5173',viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},reporter:'list',workers:1});
