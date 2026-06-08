const { Keyboard } = require("@maxhub/max-bot-api");
const servicesService = require("../../../services/services");
const { clearAdminScenario } = require("../helpers");
const { buildServicesMenuKeyboard } = require("../keyboards");

function createServicesHandlers({ adapter, menus }) {
  const showServicesList = async (ctx) => {
    const services = servicesService.getAllServices();
    if (!services.length) {
      await adapter.reply(ctx, "Нет услуг в системе.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    const text = services
      .map(
        (s) =>
          `• ${s.name}\n  Ключ: ${s.key}\n  Цена: ${
            s.price !== null ? `${s.price} ₽` : "не указана"
          }\n  Продолжительность: ${s.durationMin} мин`,
      )
      .join("\n\n");
    await adapter.reply(ctx, `Список услуг:\n\n${text}`, {
      attachments: [buildServicesMenuKeyboard()],
    });
  };

  const startAddService = async (ctx) => {
    ctx.session.servicesAction = { type: "create", step: "key" };
    await adapter.reply(
      ctx,
      "Добавление новой услуги.\n\nОтправьте ключ услуги (латинские буквы, цифры, подчёркивания, например: NEW_SERVICE):\nДля отмены напишите /admin_cancel",
    );
  };

  const showEditServicePicker = async (ctx) => {
    const services = servicesService.getAllServices();
    if (!services.length) {
      await adapter.reply(ctx, "Нет услуг для изменения.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    const rows = services.map((s) => [
      Keyboard.button.callback(`${s.name} (${s.key})`, `service_edit:${s.key}`),
    ]);
    rows.push([Keyboard.button.callback("Отменить", "service_cancel")]);
    await adapter.reply(ctx, "Выберите услугу для изменения:", {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
  };

  const showDeleteServicePicker = async (ctx) => {
    const services = servicesService.getAllServices();
    if (!services.length) {
      await adapter.reply(ctx, "Нет услуг для удаления.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    const rows = services.map((s) => [
      Keyboard.button.callback(`${s.name} (${s.key})`, `service_delete:${s.key}`),
    ]);
    rows.push([Keyboard.button.callback("Отменить", "service_cancel")]);
    await adapter.reply(ctx, "Выберите услугу для удаления:", {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
  };

  const handleServiceEditCallback = async (ctx, key) => {
    await adapter.answerCallback(ctx);
    const service = servicesService.getServiceByKey(key);
    if (!service) {
      await adapter.reply(ctx, "Услуга не найдена.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    ctx.session.servicesAction = {
      type: "update",
      key,
      step: "field",
    };
    const rows = [
      [Keyboard.button.callback("Название", "service_field:name")],
      [Keyboard.button.callback("Цена", "service_field:price")],
      [
        Keyboard.button.callback(
          "Продолжительность",
          "service_field:durationMin",
        ),
      ],
      [Keyboard.button.callback("Отменить", "service_cancel")],
    ];
    await adapter.reply(
      ctx,
      `Редактирование услуги: ${service.name}\n\nТекущие значения:\nНазвание: ${
        service.name
      }\nЦена: ${
        service.price !== null ? `${service.price} ₽` : "не указана"
      }\nПродолжительность: ${
        service.durationMin
      } мин\n\nВыберите поле для изменения:`,
      { attachments: [Keyboard.inlineKeyboard(rows)] },
    );
  };

  const handleServiceFieldCallback = async (ctx, field) => {
    await adapter.answerCallback(ctx);
    const servicesAction = ctx.session?.servicesAction;
    if (!servicesAction || servicesAction.type !== "update") {
      clearAdminScenario(ctx);
      await menus.showMainMenu(ctx, "Сессия истекла. Начните заново.");
      return;
    }
    servicesAction.step = field;
    const fieldNames = {
      name: "название",
      price: "цену (число или 'удалить' для очистки)",
      durationMin: "продолжительность в минутах",
    };
    await adapter.reply(
      ctx,
      `Отправьте новое значение для поля "${fieldNames[field]}":\nДля отмены напишите /admin_cancel`,
    );
  };

  const handleServiceDeleteCallback = async (ctx, key) => {
    await adapter.answerCallback(ctx);
    const service = servicesService.getServiceByKey(key);
    if (!service) {
      await adapter.reply(ctx, "Услуга не найдена.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    const result = servicesService.deleteService(key);
    if (result.ok) {
      await adapter.reply(ctx, `Услуга "${service.name}" удалена.`, {
        attachments: [buildServicesMenuKeyboard()],
      });
    } else {
      await adapter.reply(ctx, `Ошибка: ${result.error}`, {
        attachments: [buildServicesMenuKeyboard()],
      });
    }
  };

  const processServicesActionText = async (ctx, text) => {
    const servicesAction = ctx.session?.servicesAction;
    if (!servicesAction) return false;

    if (servicesAction.type === "create") {
      if (servicesAction.step === "key") {
        const key = text.toUpperCase();
        if (servicesService.getServiceByKey(key)) {
          await adapter.reply(
            ctx,
            "Услуга с таким ключом уже существует. Попробуйте другой ключ или /admin_cancel для отмены.",
          );
          return true;
        }
        if (!/^[A-Za-z0-9_]+$/.test(key)) {
          await adapter.reply(
            ctx,
            "Ключ должен содержать только латинские буквы, цифры и подчёркивания. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        ctx.session.servicesAction = { type: "create", step: "name", key };
        await adapter.reply(ctx, "Отправьте название услуги:");
        return true;
      }
      if (servicesAction.step === "name") {
        if (!text) {
          await adapter.reply(
            ctx,
            "Название не может быть пустым. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        ctx.session.servicesAction = {
          type: "create",
          step: "price",
          key: servicesAction.key,
          name: text,
        };
        await adapter.reply(
          ctx,
          "Отправьте цену услуги (число в рублях) или 'нет' если цена не указана:",
        );
        return true;
      }
      if (servicesAction.step === "price") {
        let price = null;
        if (text.toLowerCase() !== "нет" && text !== "") {
          const priceNum = Number(text);
          if (Number.isNaN(priceNum) || priceNum < 0) {
            await adapter.reply(
              ctx,
              "Цена должна быть неотрицательным числом или 'нет'. Попробуйте снова или /admin_cancel для отмены.",
            );
            return true;
          }
          price = priceNum;
        }
        ctx.session.servicesAction = {
          type: "create",
          step: "duration",
          key: servicesAction.key,
          name: servicesAction.name,
          price,
        };
        await adapter.reply(ctx, "Отправьте продолжительность услуги в минутах:");
        return true;
      }
      if (servicesAction.step === "duration") {
        const durationNum = Number(text);
        if (Number.isNaN(durationNum) || durationNum <= 0) {
          await adapter.reply(
            ctx,
            "Продолжительность должна быть положительным числом. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        const result = servicesService.createService({
          key: servicesAction.key,
          name: servicesAction.name,
          price: servicesAction.price,
          durationMin: durationNum,
        });
        delete ctx.session.servicesAction;
        if (result.ok) {
          await adapter.reply(
            ctx,
            `Услуга "${result.service.name}" успешно создана!\nКлюч: ${
              result.service.key
            }\nЦена: ${
              result.service.price !== null
                ? `${result.service.price} ₽`
                : "не указана"
            }\nПродолжительность: ${result.service.durationMin} мин`,
            { attachments: [buildServicesMenuKeyboard()] },
          );
        } else {
          await adapter.reply(ctx, `Ошибка при создании услуги: ${result.error}`, {
            attachments: [buildServicesMenuKeyboard()],
          });
        }
        return true;
      }
    }

    if (servicesAction.type === "update") {
      const field = servicesAction.step;
      if (field === "name") {
        if (!text) {
          await adapter.reply(
            ctx,
            "Название не может быть пустым. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        const result = servicesService.updateService(servicesAction.key, {
          name: text,
        });
        delete ctx.session.servicesAction;
        await adapter.reply(
          ctx,
          result.ok
            ? `Название услуги обновлено: "${result.service.name}"`
            : `Ошибка: ${result.error}`,
          { attachments: [buildServicesMenuKeyboard()] },
        );
        return true;
      }
      if (field === "price") {
        let price = null;
        if (
          text.toLowerCase() !== "удалить" &&
          text.toLowerCase() !== "нет" &&
          text !== ""
        ) {
          const priceNum = Number(text);
          if (Number.isNaN(priceNum) || priceNum < 0) {
            await adapter.reply(
              ctx,
              "Цена должна быть неотрицательным числом, 'удалить' или 'нет'. Попробуйте снова или /admin_cancel для отмены.",
            );
            return true;
          }
          price = priceNum;
        }
        const result = servicesService.updateService(servicesAction.key, {
          price,
        });
        delete ctx.session.servicesAction;
        await adapter.reply(
          ctx,
          result.ok
            ? `Цена услуги обновлена: ${
                result.service.price !== null
                  ? `${result.service.price} ₽`
                  : "не указана"
              }`
            : `Ошибка: ${result.error}`,
          { attachments: [buildServicesMenuKeyboard()] },
        );
        return true;
      }
      if (field === "durationMin") {
        const durationNum = Number(text);
        if (Number.isNaN(durationNum) || durationNum <= 0) {
          await adapter.reply(
            ctx,
            "Продолжительность должна быть положительным числом. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        const result = servicesService.updateService(servicesAction.key, {
          durationMin: durationNum,
        });
        delete ctx.session.servicesAction;
        await adapter.reply(
          ctx,
          result.ok
            ? `Продолжительность услуги обновлена: ${result.service.durationMin} мин`
            : `Ошибка: ${result.error}`,
          { attachments: [buildServicesMenuKeyboard()] },
        );
        return true;
      }
    }

    return false;
  };

  return {
    showServicesList,
    startAddService,
    showEditServicePicker,
    showDeleteServicePicker,
    handleServiceEditCallback,
    handleServiceFieldCallback,
    handleServiceDeleteCallback,
    processServicesActionText,
  };
}

module.exports = { createServicesHandlers };
