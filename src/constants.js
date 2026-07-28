export const COLORS = [
  '#e11d48',
  '#eab308',
  '#34d399',
  '#60a5fa',
  '#a78bfa',
  '#14b8a6',
  '#f43f5e',
  '#6366f1',
];

export const TYPE_LABEL = {
  movie: 'Фильм',
  series: 'Сериал',
  anime: 'Аниме',
};

export const STATUS_LABEL = {
  want: 'Хотим посмотреть',
  watching: 'Смотрим сейчас',
  watched: 'Уже посмотрели',
};

export const STATUS_LABEL_SHORT = {
  want: 'Хотим',
  watching: 'Смотрим',
  watched: 'Посмотрели',
};

export const STATUS_SECTIONS = [
  {
    id: 'want',
    title: 'Хотим посмотреть',
    hint: 'Очередь на просмотр',
    empty: 'Список желаний пуст — добавьте что-нибудь',
  },
  {
    id: 'watching',
    title: 'Смотрим сейчас',
    hint: 'То, что уже начали',
    empty: 'Пока ничего не смотрите',
  },
  {
    id: 'watched',
    title: 'Уже посмотрели',
    hint: 'Архив просмотренного',
    empty: 'Ещё ничего не отметили как просмотренное',
  },
];

export const SECTION_PAGE_ALL = 6;
export const SECTION_PAGE_FOCUS = 12;
export const SECTION_PAGE_STEP = 12;
export const USER_KEY = 'watch-together-user';
