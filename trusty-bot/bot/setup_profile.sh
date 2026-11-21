read -rsp 'Токен бота: ' T && echo && A="https://api.telegram.org/bot$T" && \
curl -s "$A/getMe" && echo && \
curl -s "$A/setMyDescription" --data-urlencode "description=Безопасный сервис для проведения сделок. Простой и удобный инструмент для прозрачного сотрудничества, фиксации договорённостей и комфортной работы на каждом этапе." && echo && \
curl -s "$A/setMyShortDescription" --data-urlencode "short_description=Безопасные сделки с разработчиками. Оплата в USDT через гаранта, после приёмки работы." && echo && \
curl -s "$A/deleteMyCommands" && echo && \
curl -sfL -o /tmp/trusty-avatar.jpg https://raw.githubusercontent.com/safarzod10-ship/safarzod/claude/telegram-guarantor-dev-search-bot-t1i99z/trusty-bot/brand/logo/png/telegram-avatar-640.jpg && \
curl -s "$A/setMyProfilePhoto" -F 'photo={"type":"static","photo":"attach://avatar"}' -F 'avatar=@/tmp/trusty-avatar.jpg' && echo; unset T A
