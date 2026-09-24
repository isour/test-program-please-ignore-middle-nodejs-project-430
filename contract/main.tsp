import "@typespec/http";
import "@typespec/openapi3";

using TypeSpec.Http;

@service(#{ title: "Flight Booking API" })
@route("/api")
namespace FlightBooking;

/* ————————————————————————— Модели ————————————————————————— */

/** Город из справочника. */
model City {
  /** Код города (например MOW). */
  code: string;

  /** Название города. */
  name: string;

  /** Страна, если известна. */
  country?: string;
}

/** Денежная сумма. */
model Money {
  /** Сумма — целое число. */
  amount: int32;

  /** Валюта: всегда RUB. */
  currency: "RUB";
}

/** Авиакомпания. */
model Airline {
  /** Код авиакомпании (например SU). */
  code: string;

  /** Название авиакомпании. */
  name: string;
}

/** Рейс. */
model Flight {
  /** Идентификатор рейса: без пробелов и слешей, используется в URL. */
  id: string;

  /** Номер рейса (например SU100). */
  flightNumber: string;

  /** Авиакомпания. */
  airline: Airline;

  /** Город вылета. */
  origin: City;

  /** Город прилёта (город целиком). */
  destination: City;

  /** Время вылета, ISO 8601 UTC: 2026-07-01T08:00:00Z. */
  departureAt: utcDateTime;

  /** Время прилёта, ISO 8601 UTC. */
  arrivalAt: utcDateTime;

  /** Длительность перелёта в минутах. */
  durationMinutes: int32;

  /** Цена за одного пассажира. */
  price: Money;

  /** Число свободных мест. */
  seatsAvailable: int32;
}

/** Пассажир: живёт только внутри брони. */
model Passenger {
  /** Имя. */
  @minLength(1)
  firstName: string;

  /** Фамилия. */
  @minLength(1)
  lastName: string;

  /** Дата рождения — только дата, 1990-05-20. */
  dateOfBirth: plainDate;

  /** Номер документа: любая непустая строка, например "1". */
  @minLength(1)
  documentNumber: string;
}

/** Контактные данные заказчика. */
model Contact {
  /** Email: обычная строка, формат схемой не проверяется. */
  @minLength(1)
  email: string;

  /** Телефон: обычная строка, шаблон не проверяется. */
  @minLength(1)
  phone: string;
}

/** Бронирование. */
model Booking {
  /**
   * Короткий уникальный код брони: ровно шесть символов [A-Z0-9], например ABC123.
   * Генерируется сервером; паттерн-валидация к клиенту не навязывается.
   */
  code: string;

  /** Статус брони. */
  status: "confirmed" | "cancelled";

  /** Рейс целиком. */
  flight: Flight;

  /** Пассажиры брони — минимум один. */
  passengers: Passenger[];

  /** Контакт заказчика. */
  contact: Contact;

  /** Итоговая стоимость: цена за пассажира × число пассажиров, считает сервер. */
  totalPrice: Money;

  /** Момент создания брони, ISO 8601 UTC. */
  createdAt: utcDateTime;
}

/** Ответ проверки живости. */
model HealthResponse {
  /** Всегда "ok". */
  status: "ok";
}

/** Единая модель ошибки API. */
model Error {
  /** Машиночитаемый код ошибки: validation_error (400) либо not_found (404). */
  code: string;

  /** Человекочитаемое сообщение. */
  message: string;
}

/** Тело запроса на создание брони. */
model CreateBookingRequest {
  /** Идентификатор существующего рейса; неизвестный — 400. */
  @minLength(1)
  flightId: string;

  /** Контакт заказчика. */
  contact: Contact;

  /** Пассажиры: минимум один, пустой список — 400. */
  @minItems(1)
  passengers: Passenger[];
}

/** Тело запроса на отмену брони. */
model CancelBookingRequest {
  /**
   * Фамилия любого пассажира брони; сравнение без учёта регистра и внешних пробелов.
   * Пустое или неверное значение — всегда 404 с обычным сообщением (не 400).
   */
  lastName: string;
}

/* ————————————————————————— Операции ————————————————————————— */

/** Проверка живости сервиса. */
@route("/health")
@get
op health(): HealthResponse;

/** Справочник городов: плоский массив городов целиком, без пагинации; пусто — обычный 200 []. */
@route("/cities")
@get
op listCities(): City[];

/**
 * Поиск рейсов.
 * Пустой результат — 200 [] (в том числе при origin == destination), это не ошибка.
 */
@route("/flights")
@get
op listFlights(
  /** Код города вылета. */
  @query
  @minLength(1)
  origin: string,

  /** Код города прилёта. */
  @query
  @minLength(1)
  destination: string,

  /** Дата вылета в формате YYYY-MM-DD. */
  @query
  date: plainDate,

  /** Число пассажиров; по умолчанию 1. */
  @query
  passengers?: int32 = 1,
): {
  @statusCode statusCode: 200;
  @body body: Flight[];
} | {
  @statusCode statusCode: 400;
  @body body: Error;
};

/** Рейс по идентификатору; неизвестный идентификатор — 404. */
@route("/flights/{id}")
@get
op getFlight(
  /** Идентификатор рейса (без пробелов и слешей). */
  @path
  id: string,
): {
  @statusCode statusCode: 200;
  @body body: Flight;
} | {
  @statusCode statusCode: 404;
  @body body: Error;
};

/**
 * Оформление брони.
 * 400: пустой список пассажиров, отсутствующее либо пустое обязательное поле, неизвестный flightId.
 * 422 намеренно не используется.
 */
@route("/bookings")
@post
op createBooking(
  /** Данные новой брони. */
  @body
  body: CreateBookingRequest,
): {
  @statusCode statusCode: 201;
  @body body: Booking;
} | {
  @statusCode statusCode: 400;
  @body body: Error;
};

/**
 * Просмотр брони по коду.
 *
 * lastName фактически обязателен: отсутствие параметра, неверная фамилия и неизвестный код
 * всегда отвечают одинаковым 404 с одинаковым сообщением — чтобы нельзя было перебирать коды;
 * 400 по этому эндпоинту не бывает, схема lastName не валидируется.
 * Фамилия сравнивается без учёта регистра и внешних пробелов и сверяется с любым пассажиром брони.
 */
@route("/bookings/{code}")
@get
op getBooking(
  /** Код брони: шесть символов [A-Z0-9]; паттерн на входе не проверяется — см. описание операции. */
  @path
  code: string,

  /** Фамилия пассажира; фактически обязателен, но схемой не валидируется — см. описание операции. */
  @query
  lastName?: string,
): {
  @statusCode statusCode: 200;
  @body body: Booking;
} | {
  @statusCode statusCode: 404;
  @body body: Error;
};

/**
 * Отмена брони.
 *
 * lastName описывается мягко, как в GET: пустое либо неверное значение и неизвестный код — всегда 404.
 * Ответ — та же бронь со статусом cancelled (не пустой ответ).
 * Повторная отмена допустима: снова 200 со статусом cancelled.
 */
@route("/bookings/{code}/cancel")
@post
op cancelBooking(
  /** Код брони: шесть символов [A-Z0-9]; паттерн на входе не проверяется. */
  @path
  code: string,

  /** Данные для отмены. */
  @body
  body: CancelBookingRequest,
): {
  @statusCode statusCode: 200;
  @body body: Booking;
} | {
  @statusCode statusCode: 404;
  @body body: Error;
};
