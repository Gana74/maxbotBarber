const { ADMIN_MODE } = require("../constants");
const { getUserId, getMessageText, getMessageImageRef, clearAdminScenario } = require("../helpers");
const {
  buildMainMenuKeyboard,
  buildSettingsMenuKeyboard,
  buildScheduleMenuKeyboard,
  buildServicesMenuKeyboard,
} = require("../keyboards");

function createCoreHandlers({ adapter, config, showUserMainMenu }) {
  const checkAdmin = (ctx) => {
    if (adapter.isAdmin(ctx)) {
      return true;
    }
    const userId = getUserId(ctx);
    const managerId = config.managerChatId;
    if (userId != null && managerId != null && userId === Number(managerId)) {
      return true;
    }
    return false;
  };

  const replyNoAccess = async (ctx) => {
    await adapter.reply(ctx, "Нет доступа к админ-панели.");
  };

  const showMainMenu = async (ctx, text) => {
    ctx.session = ctx.session || {};
    ctx.session.mode = ADMIN_MODE;
    clearAdminScenario(ctx);
    await adapter.reply(
      ctx,
      text || "Включён режим администратора. Выберите действие:",
      { attachments: [buildMainMenuKeyboard()] },
    );
  };

  const showSettingsMenu = async (ctx) => {
    ctx.session.fromSettings = true;
    await adapter.reply(ctx, "Настройки. Выберите действие:", {
      attachments: [buildSettingsMenuKeyboard()],
    });
  };

  const showScheduleMenu = async (ctx) => {
    ctx.session.fromSettings = true;
    delete ctx.session.scheduleAction;
    await adapter.reply(ctx, "Настройки расписания. Выберите действие:", {
      attachments: [buildScheduleMenuKeyboard()],
    });
  };

  const showServicesMenu = async (ctx) => {
    ctx.session.fromSettings = true;
    await adapter.reply(ctx, "Управление услугами. Выберите действие:", {
      attachments: [buildServicesMenuKeyboard()],
    });
  };

  const handleAdminCancel = async (ctx) => {
    clearAdminScenario(ctx);
    await showMainMenu(ctx, "Действие админа отменено.");
  };

  const createHandleAdminCallback = (domains) => {
    const actionHandlers = {
      bookings: domains.bookings.showAllBookings,
      stats: domains.bookings.showStats,
      cancel_code: domains.bookings.startCancelByCode,
      broadcast: domains.broadcast.startBroadcast,
      broadcast_status: domains.broadcast.showBroadcastStatus,
      revenue: domains.revenue.showRevenueMenu,
      broadcast_confirm: domains.broadcast.handleBroadcastConfirm,
      broadcast_cancel: domains.broadcast.handleBroadcastCancel,
      settings: showSettingsMenu,
      schedule_menu: showScheduleMenu,
      schedule_view: domains.schedule.startScheduleView,
      schedule_edit: domains.schedule.startScheduleEdit,
      schedule_delete: domains.schedule.startScheduleDelete,
      schedule_all: domains.schedule.showAllSchedule,
      schedule_weekday: domains.schedule.startScheduleWeekday,
      main_menu: showMainMenu,
      services_menu: showServicesMenu,
      services_list: domains.services.showServicesList,
      services_add: domains.services.startAddService,
      services_edit: domains.services.showEditServicePicker,
      services_delete: domains.services.showDeleteServicePicker,
      ban: domains.settings.startBan,
      unban: domains.settings.startUnban,
      reminder_28: domains.settings.startReminder28,
      tips_link: domains.settings.startTipsLink,
      contacts: domains.settings.startEditContacts,
      portfolio_upload: domains.settings.startPortfolioUpload,
      portfolio_delete: domains.settings.startPortfolioDelete,
      save_location: domains.settings.startSaveLocation,
    };

    return async (ctx, action) => {
      await adapter.answerCallback(ctx);

      if (action === "services_back") {
        if (ctx.session?.fromSettings) {
          delete ctx.session.servicesAction;
          await showSettingsMenu(ctx);
        } else {
          await showMainMenu(ctx);
        }
        return;
      }

      if (action === "user_mode") {
        clearAdminScenario(ctx);
        await showUserMainMenu(
          ctx,
          "Режим пользователя.\n\n👇 Выберите действие с помощью кнопок ниже:",
        );
        return;
      }

      const handler = actionHandlers[action];
      if (handler) {
        await handler(ctx);
      }
    };
  };

  const createHandleAdminText = (domains) => async (ctx) => {
    const text = getMessageText(ctx);
    if (!text) return false;

    if (await domains.schedule.processScheduleActionText(ctx, text)) {
      return true;
    }
    if (await domains.services.processServicesActionText(ctx, text)) {
      return true;
    }
    if (await domains.bookings.processCancelByCodeText(ctx, text)) {
      return true;
    }
    if (await domains.settings.processSettingsActionText(ctx, text)) {
      return true;
    }
    if (await domains.broadcast.processBroadcastText(ctx, text)) {
      return true;
    }
    return false;
  };

  const createHandleAdminImage = (domains) => async (ctx) => {
    const action = ctx.session?.adminAction?.type;
    if (!action) return false;

    const imageRef = getMessageImageRef(ctx);
    if (!imageRef) return false;

    if (await domains.settings.handlePortfolioUploadImage(ctx)) {
      return true;
    }
    if (await domains.broadcast.handleBroadcastImage(ctx, imageRef)) {
      return true;
    }

    return false;
  };

  return {
    checkAdmin,
    replyNoAccess,
    showMainMenu,
    showSettingsMenu,
    showScheduleMenu,
    showServicesMenu,
    handleAdminCancel,
    createHandleAdminCallback,
    createHandleAdminText,
    createHandleAdminImage,
  };
}

module.exports = { createCoreHandlers };
