const { toIsoDate } = require("../helpers");
const { validateDateStr, validateTimeStr } = require("../../../utils/security");
const { sanitizeErrorMessage } = require("../../../utils/errorHandler");
const { buildScheduleMenuKeyboard } = require("../keyboards");

function createScheduleHandlers({ adapter, sheetsService }) {
  const startScheduleView = async (ctx) => {
    ctx.session.scheduleAction = { type: "view", step: "date" };
    await adapter.reply(
      ctx,
      "Укажите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД для просмотра расписания:",
    );
  };

  const startScheduleEdit = async (ctx) => {
    ctx.session.scheduleAction = { type: "edit", step: "date" };
    await adapter.reply(
      ctx,
      "Укажите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД для изменения/добавления расписания:",
    );
  };

  const startScheduleDelete = async (ctx) => {
    ctx.session.scheduleAction = { type: "delete", step: "date" };
    await adapter.reply(
      ctx,
      "Укажите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД для удаления расписания:",
    );
  };

  const showAllSchedule = async (ctx) => {
    try {
      const rows = (await sheetsService.getWorkHoursRaw()) || [];
      const nonEmpty = rows.filter(
        (r) => (r.date || r.rawDate || "").trim() || (r.weekday || "").trim(),
      );

      if (!nonEmpty.length) {
        await adapter.reply(ctx, "Расписание пусто в окне из 50 строк.", {
          attachments: [buildScheduleMenuKeyboard()],
        });
        return;
      }

      const lines = nonEmpty.map((r, idx) => {
        const label =
          (r.date || r.rawDate || "").trim() || `шаблон: ${r.weekday}`;
        const base = `#${idx + 1}. ${label}`;
        const work = r.start && r.end ? ` ${r.start}–${r.end}` : "";
        const lunch =
          r.lunchStart && r.lunchEnd
            ? `, обед ${r.lunchStart}–${r.lunchEnd}`
            : "";
        return base + work + lunch;
      });

      await adapter.reply(
        ctx,
        'Текущее окно расписания (первые 50 строк листа "Расписание"):\n\n' +
          lines.join("\n"),
        { attachments: [buildScheduleMenuKeyboard()] },
      );
      await adapter.reply(
        ctx,
        'Чтобы отредактировать конкретную дату, используйте пункт "Изменить/добавить расписание на дату" и укажите нужную дату.',
      );
    } catch (e) {
      await adapter.reply(ctx, `Ошибка при получении расписания: ${sanitizeErrorMessage(e)}`, {
        attachments: [buildScheduleMenuKeyboard()],
      });
    }
  };

  const startScheduleWeekday = async (ctx) => {
    try {
      const rows = (await sheetsService.getWorkHoursRaw()) || [];
      const templates = rows.filter((r) => !r.date && (r.weekday || "").trim());

      if (!templates.length) {
        await adapter.reply(
          ctx,
          "Шаблоны по дням недели ещё не заданы. Можно настроить их, ответив на вопросы ниже.",
        );
      } else {
        const lines = templates.map((r) => {
          const work =
            r.start && r.end ? ` ${r.start}–${r.end}` : " (время не задано)";
          const lunch =
            r.lunchStart && r.lunchEnd
              ? `, обед ${r.lunchStart}–${r.lunchEnd}`
              : "";
          return `${r.weekday}${work}${lunch}`;
        });
        await adapter.reply(
          ctx,
          "Текущие шаблоны по дням недели:\n\n" + lines.join("\n"),
        );
      }

      ctx.session.scheduleAction = { type: "weekday_edit", step: "weekday" };
      await adapter.reply(
        ctx,
        'Укажите день недели (например, Пн, Вт, Ср или mon/tue/...)\nили напишите "удалить Пн" чтобы удалить шаблон для Пн:',
      );
    } catch (e) {
      await adapter.reply(ctx, `Ошибка при получении шаблонов: ${sanitizeErrorMessage(e)}`);
    }
  };

  const processScheduleActionText = async (ctx, text) => {
    const scheduleAction = ctx.session?.scheduleAction;
    if (!scheduleAction) return false;

    if (scheduleAction.step === "date") {
      const input = (text || "").trim();
      if (!input) {
        await adapter.reply(
          ctx,
          "Дата не может быть пустой. Укажите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД:",
        );
        return true;
      }

      scheduleAction.dateInput = input;
      const isoDate = toIsoDate(input);
      if (!isoDate || !validateDateStr(isoDate)) {
        await adapter.reply(
          ctx,
          "Некорректная дата. Используйте ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.",
        );
        return true;
      }

      if (scheduleAction.type === "view") {
        try {
          const workHours = await sheetsService.getWorkHoursForDate(isoDate);
          if (!workHours || !workHours.start || !workHours.end) {
            await adapter.reply(ctx, "На эту дату расписание не задано (выходной).", {
              attachments: [buildScheduleMenuKeyboard()],
            });
          } else {
            const infoLines = [
              `Расписание на ${input}:`,
              `Рабочее время: ${workHours.start}–${workHours.end}`,
            ];
            if (workHours.lunchStart && workHours.lunchEnd) {
              infoLines.push(
                `Обед: ${workHours.lunchStart}–${workHours.lunchEnd}`,
              );
            }
            await adapter.reply(ctx, infoLines.join("\n"), {
              attachments: [buildScheduleMenuKeyboard()],
            });
          }
        } catch (e) {
          await adapter.reply(ctx, `Ошибка при получении расписания: ${sanitizeErrorMessage(e)}`);
        }
        delete ctx.session.scheduleAction;
        return true;
      }

      if (scheduleAction.type === "edit") {
        scheduleAction.step = "start";
        await adapter.reply(
          ctx,
          `Укажите время начала рабочего дня для ${input} в формате HH:MM (например, 10:00):`,
        );
        return true;
      }

      if (scheduleAction.type === "delete") {
        try {
          await sheetsService.deleteWorkHoursForDate(isoDate);
          await adapter.reply(
            ctx,
            `Расписание на дату ${input} удалено (если было задано).`,
            { attachments: [buildScheduleMenuKeyboard()] },
          );
        } catch (e) {
          await adapter.reply(ctx, `Ошибка при удалении расписания: ${sanitizeErrorMessage(e)}`);
        }
        delete ctx.session.scheduleAction;
        return true;
      }
    }

    if (scheduleAction.type === "edit") {
      const dateInput = scheduleAction.dateInput;
      if (!dateInput) {
        delete ctx.session.scheduleAction;
        await adapter.reply(ctx, "Сессия настройки расписания истекла. Начните заново.", {
          attachments: [buildScheduleMenuKeyboard()],
        });
        return true;
      }

      if (scheduleAction.step === "start") {
        if (!validateTimeStr(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время в формате HH:MM (например, 10:00):",
          );
          return true;
        }
        scheduleAction.start = text;
        scheduleAction.step = "end";
        await adapter.reply(
          ctx,
          "Укажите время окончания рабочего дня в формате HH:MM (например, 20:00):",
        );
        return true;
      }

      if (scheduleAction.step === "end") {
        if (!validateTimeStr(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время в формате HH:MM (например, 20:00):",
          );
          return true;
        }
        scheduleAction.end = text;
        scheduleAction.step = "lunch_start";
        await adapter.reply(
          ctx,
          'Укажите время начала обеда в формате HH:MM или "-" если без обеда:',
        );
        return true;
      }

      if (scheduleAction.step === "lunch_start") {
        let lunchStart = "";
        if (text && text.trim() !== "-") {
          if (!validateTimeStr(text || "")) {
            await adapter.reply(
              ctx,
              'Некорректный формат времени. Укажите время в формате HH:MM или "-" если без обеда:',
            );
            return true;
          }
          lunchStart = text;
        }
        scheduleAction.lunchStart = lunchStart;
        if (lunchStart) {
          scheduleAction.step = "lunch_end";
          await adapter.reply(
            ctx,
            "Укажите время окончания обеда в формате HH:MM (должно быть позже начала обеда):",
          );
        } else {
          scheduleAction.step = "confirm";
          await adapter.reply(
            ctx,
            'Обед будет отсутствовать. Подтвердите сохранение: напишите "Да" или "Нет".',
          );
        }
        return true;
      }

      if (scheduleAction.step === "lunch_end") {
        const lunchStart = scheduleAction.lunchStart;
        let lunchEnd = "";
        if (text && text.trim() !== "-") {
          if (!validateTimeStr(text || "")) {
            await adapter.reply(
              ctx,
              "Некорректный формат времени. Укажите время окончания обеда в формате HH:MM:",
            );
            return true;
          }
          lunchEnd = text;
        }
        scheduleAction.lunchEnd = lunchEnd;
        scheduleAction.step = "confirm";

        const summary = [
          `Расписание на ${dateInput}:`,
          `Рабочее время: ${scheduleAction.start}–${scheduleAction.end}`,
          lunchStart && lunchEnd
            ? `Обед: ${lunchStart}–${lunchEnd}`
            : "Обед: нет",
          "",
          'Подтвердите сохранение: напишите "Да" или "Нет".',
        ].join("\n");
        await adapter.reply(ctx, summary);
        return true;
      }

      if (scheduleAction.step === "confirm") {
        const answer = (text || "").trim().toLowerCase();
        if (answer !== "да" && answer !== "нет") {
          await adapter.reply(ctx, 'Ответьте "Да" для сохранения или "Нет" для отмены.');
          return true;
        }
        if (answer === "нет") {
          delete ctx.session.scheduleAction;
          await adapter.reply(ctx, "Изменение расписания отменено.", {
            attachments: [buildScheduleMenuKeyboard()],
          });
          return true;
        }

        try {
          await sheetsService.setWorkHoursForDate(scheduleAction.dateInput, {
            start: scheduleAction.start,
            end: scheduleAction.end,
            lunchStart: scheduleAction.lunchStart,
            lunchEnd: scheduleAction.lunchEnd,
          });
          await adapter.reply(
            ctx,
            `Расписание на дату ${scheduleAction.dateInput} сохранено.`,
            { attachments: [buildScheduleMenuKeyboard()] },
          );
        } catch (e) {
          await adapter.reply(ctx, `Ошибка при сохранении расписания: ${sanitizeErrorMessage(e)}`);
        }
        delete ctx.session.scheduleAction;
        return true;
      }
    }

    if (scheduleAction.type === "weekday_edit") {
      if (scheduleAction.step === "weekday") {
        if (!text) {
          await adapter.reply(
            ctx,
            'Укажите день недели (например, Пн, Вт, Ср или mon/tue/...) или "удалить Пн":',
          );
          return true;
        }

        const lower = text.toLowerCase();
        if (lower.startsWith("удалить")) {
          const parts = text.split(/\s+/);
          const dayToken = parts[1];
          if (!dayToken) {
            await adapter.reply(ctx, 'Укажите день для удаления, например: "удалить Пн".');
            return true;
          }
          try {
            await sheetsService.deleteWeekdayTemplate(dayToken);
            await adapter.reply(
              ctx,
              `Шаблон для дня "${dayToken}" удалён (если существовал).`,
              { attachments: [buildScheduleMenuKeyboard()] },
            );
          } catch (e) {
            await adapter.reply(ctx, `Ошибка при удалении шаблона: ${sanitizeErrorMessage(e)}`);
          }
          delete ctx.session.scheduleAction;
          return true;
        }

        scheduleAction.weekdayKey = text;
        scheduleAction.step = "weekday_start";
        await adapter.reply(
          ctx,
          `Укажите время начала рабочего дня для шаблона "${text}" в формате HH:MM:`,
        );
        return true;
      }

      if (scheduleAction.step === "weekday_start") {
        if (!validateTimeStr(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время в формате HH:MM:",
          );
          return true;
        }
        scheduleAction.start = text;
        scheduleAction.step = "weekday_end";
        await adapter.reply(
          ctx,
          "Укажите время окончания рабочего дня в формате HH:MM:",
        );
        return true;
      }

      if (scheduleAction.step === "weekday_end") {
        if (!validateTimeStr(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время в формате HH:MM:",
          );
          return true;
        }
        scheduleAction.end = text;
        scheduleAction.step = "weekday_lunch_start";
        await adapter.reply(
          ctx,
          'Укажите время начала обеда в формате HH:MM или "-" если без обеда:',
        );
        return true;
      }

      if (scheduleAction.step === "weekday_lunch_start") {
        let lunchStart = "";
        if (text && text.trim() !== "-") {
          if (!validateTimeStr(text || "")) {
            await adapter.reply(
              ctx,
              'Некорректный формат времени. Укажите время в формате HH:MM или "-" если без обеда:',
            );
            return true;
          }
          lunchStart = text;
        }
        scheduleAction.lunchStart = lunchStart;

        if (!lunchStart) {
          scheduleAction.lunchEnd = "";
          scheduleAction.step = "weekday_confirm";
          const d = scheduleAction.weekdayKey;
          const summary = [
            `Шаблон для дня "${d}":`,
            `Рабочее время: ${scheduleAction.start}–${scheduleAction.end}`,
            "Обед: нет",
            "",
            'Подтвердите сохранение шаблона: напишите "Да" или "Нет".',
          ].join("\n");
          await adapter.reply(ctx, summary);
          return true;
        }

        scheduleAction.step = "weekday_lunch_end";
        await adapter.reply(
          ctx,
          "Укажите время окончания обеда в формате HH:MM (должно быть позже начала обеда):",
        );
        return true;
      }

      if (scheduleAction.step === "weekday_lunch_end") {
        if (!validateTimeStr(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время окончания обеда в формате HH:MM:",
          );
          return true;
        }
        scheduleAction.lunchEnd = text;
        scheduleAction.step = "weekday_confirm";

        const d = scheduleAction.weekdayKey;
        const summary = [
          `Шаблон для дня "${d}":`,
          `Рабочее время: ${scheduleAction.start}–${scheduleAction.end}`,
          `Обед: ${scheduleAction.lunchStart}–${scheduleAction.lunchEnd}`,
          "",
          'Подтвердите сохранение шаблона: напишите "Да" или "Нет".',
        ].join("\n");
        await adapter.reply(ctx, summary);
        return true;
      }

      if (scheduleAction.step === "weekday_confirm") {
        const answer = (text || "").trim().toLowerCase();
        if (answer !== "да" && answer !== "нет") {
          await adapter.reply(ctx, 'Ответьте "Да" для сохранения или "Нет" для отмены.');
          return true;
        }
        if (answer === "нет") {
          delete ctx.session.scheduleAction;
          await adapter.reply(ctx, "Изменение шаблона отменено.", {
            attachments: [buildScheduleMenuKeyboard()],
          });
          return true;
        }

        try {
          await sheetsService.setWeekdayTemplate(scheduleAction.weekdayKey, {
            start: scheduleAction.start,
            end: scheduleAction.end,
            lunchStart: scheduleAction.lunchStart,
            lunchEnd: scheduleAction.lunchEnd,
          });
          await adapter.reply(
            ctx,
            `Шаблон для дня "${scheduleAction.weekdayKey}" сохранён.`,
            { attachments: [buildScheduleMenuKeyboard()] },
          );
        } catch (e) {
          await adapter.reply(ctx, `Ошибка при сохранении шаблона: ${sanitizeErrorMessage(e)}`);
        }
        delete ctx.session.scheduleAction;
        return true;
      }
    }

    return false;
  };

  return {
    startScheduleView,
    startScheduleEdit,
    startScheduleDelete,
    showAllSchedule,
    startScheduleWeekday,
    processScheduleActionText,
  };
}

module.exports = { createScheduleHandlers };
