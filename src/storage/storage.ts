import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, Course } from '../types';
import { DEFAULT_SETTINGS } from '../constants';

const COURSES_KEY = 'univtimetable/courses/v1';
const SETTINGS_KEY = 'univtimetable/settings/v1';

export async function loadCourses(): Promise<Course[]> {
  try {
    const raw = await AsyncStorage.getItem(COURSES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Course[]) : [];
  } catch (e) {
    console.warn('loadCourses failed', e);
    return [];
  }
}

export async function saveCourses(courses: Course[]): Promise<void> {
  try {
    await AsyncStorage.setItem(COURSES_KEY, JSON.stringify(courses));
  } catch (e) {
    console.warn('saveCourses failed', e);
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      ai: { ...DEFAULT_SETTINGS.ai, ...(parsed.ai || {}) },
      jwc: { ...DEFAULT_SETTINGS.jwc, ...(parsed.jwc || {}) },
      meta: { ...DEFAULT_SETTINGS.meta, ...(parsed.meta || {}) },
      periods: Array.isArray(parsed.periods) && parsed.periods.length ? parsed.periods : DEFAULT_SETTINGS.periods,
    };
  } catch (e) {
    console.warn('loadSettings failed', e);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('saveSettings failed', e);
  }
}
