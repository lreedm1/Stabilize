import Foundation

struct ChatMessage: Identifiable, Equatable {
    enum Role: Equatable {
        case user
        case assistant
    }

    let id: UUID
    let role: Role
    let text: String
    let route: String?
    let isUrgent: Bool

    init(
        id: UUID = UUID(),
        role: Role,
        text: String,
        route: String? = nil,
        isUrgent: Bool = false
    ) {
        self.id = id
        self.role = role
        self.text = text
        self.route = route
        self.isUrgent = isUrgent
    }
}
