defmodule OpenBoardWeb.Presence do
  use Phoenix.Presence,
    otp_app: :open_board,
    pubsub_server: OpenBoard.PubSub
end
