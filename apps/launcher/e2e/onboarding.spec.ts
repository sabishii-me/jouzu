import {test,expect} from '@playwright/test';

test('model setup and workspaces preserve preferences and share settings', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?onboarding=1');
 await expect(page.getByRole('heading',{name:'Make Jouzu yours'})).toBeVisible();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect a model'})).toBeVisible();
 await page.getByRole('button',{name:'Return to workspaces',exact:true}).click();
 await page.getByRole('button',{name:'Return to model setup',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect a model'})).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Sign in to Shisa',exact:true}).click();
 await dialog.getByRole('button',{name:'Complete demo authorization'}).click();
 await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Return to model setup',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Connect a model'})).toHaveCount(0);
});

test('languages are discoverable and provider search includes custom credentials', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?onboarding=1');
 for(const name of ['English','日本語','简体中文','繁體中文']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('button',{name:'Add provider',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Sign in to Shisa',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Search services'})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Service',exact:true}).click();
 await page.getByRole('textbox',{name:'Search services'}).fill('custom');
 await page.getByRole('option',{name:'Custom provider',exact:true}).click();
 await expect(page.getByLabel('API key',{exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'API base URL'})).toBeVisible();
});
