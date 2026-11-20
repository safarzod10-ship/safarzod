read -rsp 'Токен бота: ' T && echo && A="https://api.telegram.org/bot$T" && \
curl -s "$A/getMe" && echo && \
curl -s "$A/setMyDescription" --data-urlencode "description=Безопасные сделки с разработчиками. Выберите исполнителя по отзывам и оплатите в USDT — деньги хранятся у гаранта, пока вы не примете работу." && echo && \
curl -s "$A/setMyShortDescription" --data-urlencode "short_description=Гарант сделок и поиск разработчиков. Оплата в USDT после приёмки работы." && echo && \
curl -s "$A/setMyCommands" --data-urlencode 'commands=[{"command":"start","description":"Открыть Trusty"},{"command":"developers","description":"Найти разработчика"},{"command":"projects","description":"Проекты и отклики"},{"command":"deals","description":"Мои сделки"},{"command":"profile","description":"Мой профиль"},{"command":"help","description":"Как работает гарант"}]' && echo && \
curl -sfL -o /tmp/trusty-avatar.jpg https://raw.githubusercontent.com/safarzod10-ship/safarzod/223b693f194bd2f385ef185d81b1e999ac7ef3e3/trusty-bot/brand/logo/png/telegram-avatar-640.jpg && \
curl -s "$A/setMyProfilePhoto" -F 'photo={"type":"static","photo":"attach://avatar"}' -F 'avatar=@/tmp/trusty-avatar.jpg' && echo; unset T A
