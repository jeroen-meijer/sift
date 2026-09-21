import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../locales/en/common.json";
import library from "../locales/en/library.json";
import settings from "../locales/en/settings.json";
import tags from "../locales/en/tags.json";

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common,
      library,
      settings,
      tags,
    },
  },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "library", "settings", "tags"],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
