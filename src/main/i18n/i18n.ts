import i18n from 'i18next';
import Backend from 'i18next-electron-fs-backend';
import { app } from 'electron';
import * as path from 'path';

const isDev = process.env.NODE_ENV === 'development';

export async function initializeI18n(language: string): Promise<void> {
  const localesPath = path.join(app.getAppPath(), 'locales');

  await i18n.use(Backend as unknown as any).init({
    lng: language,
    fallbackLng: 'en',
    debug: isDev,
    ns: ['common'],
    defaultNS: 'common',
    backend: {
      loadPath: path.join(localesPath, '{{lng}}/{{ns}}.json'),
      addPath: path.join(localesPath, '{{lng}}/{{ns}}.missing.json'),
    },
    interpolation: {
      escapeValue: false,
    },
    saveMissing: false,
  });
}

export function t(key: string, options?: any): string {
  return i18n.t(key, options) as string;
}

export async function changeLanguage(language: string): Promise<void> {
  await i18n.changeLanguage(language);
}

export default i18n;
